#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SUPPORTED_EXTENSIONS = new Set([".atlas", ".jpeg", ".jpg", ".png", ".skel", ".webp"]);
const TEXTURE_EXTENSIONS = new Set([".jpeg", ".jpg", ".png", ".webp"]);
const REQUIRED_SOURCE_FIELDS = ["id", "name", "author", "license", "licenseWarning", "licenseNote"];
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const GIT_SHA_PATTERN = /^[a-f0-9]{40}$/;
const SPINE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function encodePath(value) {
  return normalizePath(value).split("/").map(encodeURIComponent).join("/");
}

function extension(name) {
  return path.posix.extname(name).toLowerCase();
}

export function detectSpineVersion(bytes) {
  const header = Buffer.from(bytes).subarray(0, 256).toString("latin1");
  return header.match(/(?:^|[^0-9])((?:3\.8|4\.[0-9])\.[0-9]+)(?:[^0-9]|$)/)?.[1] || "";
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function titleFromDirectory(directory, source = {}) {
  const withoutPrefix = (source.stripPrefixes || []).reduce(
    (value, prefix) => value.replace(new RegExp(`^${prefix}[_-]?`, "i"), ""),
    directory
  );
  return withoutPrefix
    .replace(/^\d+[_-]?/, "")
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.length === 2 && /^\d+$/.test(part) ? `#${part}` : `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(" ") || directory;
}

function identifier(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function validateSource(source) {
  assert(isPlainObject(source), "Catalog source must be an object.");
  for (const field of REQUIRED_SOURCE_FIELDS) assert(String(source[field] || "").trim(), `Catalog source requires ${field}.`);
  assert(/^[a-z0-9][a-z0-9-]*$/.test(source.id), "Catalog source id must be lowercase kebab-case.");
  assert(isPlainObject(source.repository), "Catalog source requires repository metadata.");
  for (const field of ["owner", "name", "ref", "modelsPath"]) {
    assert(String(source.repository[field] || "").trim(), `Catalog repository requires ${field}.`);
  }
  assert(isPlainObject(source.spine), "Catalog source requires Spine compatibility metadata.");
  assert(SPINE_VERSION_PATTERN.test(source.spine.min || ""), "Catalog source spine.min must be major.minor.patch.");
  assert(SPINE_VERSION_PATTERN.test(source.spine.max || ""), "Catalog source spine.max must be major.minor.patch.");
  if (source.includeDirectories !== undefined) {
    assert(Array.isArray(source.includeDirectories) && source.includeDirectories.length > 0, "includeDirectories must be a non-empty array when provided.");
    for (const directory of source.includeDirectories) {
      assert(typeof directory === "string" && directory && !directory.includes("/"), "includeDirectories entries must be direct model directory names.");
    }
  }
}

async function fetchResponse(fetchImpl, url) {
  let error;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const headers = { "user-agent": "spine-companion-catalog-generator" };
      const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
      if (token && url.startsWith("https://api.github.com/")) headers.authorization = `Bearer ${token}`;
      const response = await fetchImpl(url, { headers });
      if (response?.ok) return response;
      error = new Error(`Request failed (${response?.status || "unknown"}) for ${url}`);
    } catch (caught) {
      error = new Error(`Request failed for ${url}: ${caught.message || caught}`);
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  throw error;
}

async function readResponse(response, url) {
  if (!response?.ok) throw new Error(`Request failed (${response?.status || "unknown"}) for ${url}`);
  return response;
}

async function fetchJson(fetchImpl, url) {
  const response = await readResponse(await fetchResponse(fetchImpl, url), url);
  return response.json();
}

async function fetchBytes(fetchImpl, url) {
  const response = await readResponse(await fetchResponse(fetchImpl, url), url);
  return Buffer.from(await response.arrayBuffer());
}

async function fetchBytesFromUrls(fetchImpl, urls) {
  let error;
  for (const url of urls) {
    try {
      return await fetchBytes(fetchImpl, url);
    } catch (caught) {
      error = caught;
    }
  }
  throw error;
}

function githubApiUrl(repository, endpoint) {
  return `https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}${endpoint}`;
}

export async function scanGithubRepository(source, { fetchImpl = fetch, localRoot = "" } = {}) {
  validateSource(source);
  const repository = source.repository;
  const repo = await fetchJson(fetchImpl, githubApiUrl(repository, ""));
  const commit = await fetchJson(fetchImpl, githubApiUrl(repository, `/commits/${encodeURIComponent(repository.ref)}`));
  const revision = String(commit.sha || "").toLowerCase();
  assert(GIT_SHA_PATTERN.test(revision), "GitHub commit response did not contain a 40-character revision SHA.");
  const tree = await fetchJson(fetchImpl, githubApiUrl(repository, `/git/trees/${revision}?recursive=1`));
  assert(!tree.truncated, "GitHub tree response is truncated; refuse to generate an incomplete catalog.");
  assert(Array.isArray(tree.tree), "GitHub tree response did not contain a tree.");

  const modelsPath = normalizePath(repository.modelsPath);
  const prefix = `${modelsPath}/`;
  const filesByModel = new Map();
  for (const entry of tree.tree) {
    if (entry?.type !== "blob" || typeof entry.path !== "string" || !entry.path.startsWith(prefix)) continue;
    const relative = entry.path.slice(prefix.length);
    const segments = relative.split("/");
    if (segments.length !== 2 || !SUPPORTED_EXTENSIONS.has(extension(segments[1]))) continue;
    const [directory, name] = segments;
    if (!filesByModel.has(directory)) filesByModel.set(directory, []);
    filesByModel.get(directory).push({ name, path: entry.path, gitSha: String(entry.sha || "").toLowerCase(), sizeBytes: entry.size });
  }

  const models = [];
  const skippedModels = [];
  const discoveredDirectories = [...filesByModel.keys()].sort(compareStrings);
  const requestedDirectories = source.includeDirectories
    ? [...source.includeDirectories].sort(compareStrings)
    : discoveredDirectories;
  const verificationEntries = requestedDirectories.flatMap((directory) => {
    const entries = filesByModel.get(directory) || [];
    const skelCount = entries.filter((entry) => extension(entry.name) === ".skel").length;
    const atlasCount = entries.filter((entry) => extension(entry.name) === ".atlas").length;
    const textureCount = entries.filter((entry) => TEXTURE_EXTENSIONS.has(extension(entry.name))).length;
    return skelCount === 1 && atlasCount > 0 && textureCount > 0 ? entries : [];
  });
  const verifiedFiles = source.metadataOnly
    ? new Map(verificationEntries.map((entry) => [entry.path, { sha256: "", spineVersion: "" }]))
    : new Map(await mapWithConcurrency(verificationEntries, Number(process.env.CATALOG_CONCURRENCY || 24), async (entry) => {
    const url = `https://raw.githubusercontent.com/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/${revision}/${encodePath(entry.path)}`;
    const fallbackUrl = `https://cdn.jsdelivr.net/gh/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}@${revision}/${encodePath(entry.path)}`;
    try {
      const bytes = localRoot
        ? await readFile(path.resolve(localRoot, ...entry.path.split("/")))
        : await fetchBytesFromUrls(fetchImpl, [fallbackUrl, url]);
      assert(bytes.length === entry.sizeBytes, `Downloaded size differs from GitHub metadata for ${entry.path}.`);
      return [entry.path, {
        sha256: createHash("sha256").update(bytes).digest("hex"),
        spineVersion: extension(entry.name) === ".skel" ? detectSpineVersion(bytes) : ""
      }];
    } catch (error) {
      return [entry.path, { error: error.message || String(error) }];
    }
    }));
  for (const directory of requestedDirectories) {
    if (!filesByModel.has(directory)) {
      skippedModels.push({ directory, reason: `Directory was not found under ${modelsPath}.` });
      continue;
    }
    const entries = filesByModel.get(directory).sort((left, right) => compareStrings(left.name, right.name));
    const skels = entries.filter((entry) => extension(entry.name) === ".skel");
    const atlases = entries.filter((entry) => extension(entry.name) === ".atlas");
    const textures = entries.filter((entry) => TEXTURE_EXTENSIONS.has(extension(entry.name)));
    const problems = [];
    if (skels.length !== 1) problems.push(`expected exactly one .skel file, found ${skels.length}`);
    if (atlases.length < 1) problems.push("missing .atlas file");
    if (textures.length < 1) problems.push("missing texture image");
    if (problems.length) {
      skippedModels.push({ directory, reason: problems.join("; ") });
      continue;
    }

    const files = [];
    for (const entry of entries) {
      assert(GIT_SHA_PATTERN.test(entry.gitSha), `GitHub tree entry ${entry.path} is missing its Git blob SHA.`);
      assert(Number.isSafeInteger(entry.sizeBytes) && entry.sizeBytes >= 0, `GitHub tree entry ${entry.path} is missing its size.`);
      const url = `https://raw.githubusercontent.com/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/${revision}/${encodePath(entry.path)}`;
      const fallbackUrl = `https://cdn.jsdelivr.net/gh/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}@${revision}/${encodePath(entry.path)}`;
      const verified = verifiedFiles.get(entry.path);
      if (!verified || verified.error) {
        problems.push(`cannot verify ${entry.name}: ${verified?.error || "missing verification result"}`);
        break;
      }
      files.push({
        name: entry.name,
        url,
        ...(verified.sha256 ? { sha256: verified.sha256 } : {}),
        sizeBytes: entry.sizeBytes,
        githubBlobSha: entry.gitSha,
        fallbackUrls: [fallbackUrl]
      });
    }

    if (problems.length) {
      skippedModels.push({ directory, reason: problems.join("; ") });
      continue;
    }
    const detectedVersion = verifiedFiles.get(skels[0].path)?.spineVersion || "";
    if (source.requireDetectedSpineVersion && !detectedVersion) {
      skippedModels.push({ directory, reason: "cannot detect Spine runtime version from .skel header" });
      continue;
    }
    if (detectedVersion && !detectedVersion.startsWith("3.8.")) {
      skippedModels.push({ directory, reason: `unsupported Spine runtime ${detectedVersion}` });
      continue;
    }
    const slug = identifier(directory);
    assert(slug, `Model directory ${directory} cannot produce an id.`);
    models.push({
      id: `${source.id}-${slug}`,
      name: titleFromDirectory(directory, source),
      source: source.name,
      author: source.author,
      license: source.license,
      licenseWarning: source.licenseWarning,
      licenseNote: source.licenseNote,
      repositoryUrl: `https://github.com/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/tree/${revision}/${encodePath(`${modelsPath}/${directory}`)}`,
      skel: skels[0].name,
      files,
      spine: detectedVersion
        ? { min: detectedVersion, max: detectedVersion }
        : { min: source.spine.min, max: source.spine.max },
      versionVerified: Boolean(detectedVersion),
      description: `Generated from ${repository.owner}/${repository.name} at ${revision}.`,
      tags: [...new Set([...(source.tags || []), "spine-3.8"])].sort(compareStrings),
      category: source.category || "operator",
      compatibilityProfile: source.compatibilityProfile || "companion"
    });
  }

  const document = {
    schemaVersion: 1,
    source: {
      id: source.id,
      name: source.name,
      author: source.author,
      license: source.license,
      licenseWarning: source.licenseWarning,
      licenseNote: source.licenseNote,
      repository: {
        owner: repository.owner,
        name: repository.name,
        configuredRef: repository.ref,
        resolvedRevision: revision,
        url: repo.html_url || `https://github.com/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`
      },
      spine: { min: source.spine.min, max: source.spine.max }
    },
    models: models.sort((left, right) => compareStrings(left.id, right.id)),
    skippedModels: skippedModels.sort((left, right) => compareStrings(left.directory, right.directory))
  };
  validateCatalog(document);
  return document;
}

export function validateCatalog(document) {
  assert(isPlainObject(document), "Catalog must be an object.");
  assert(document.schemaVersion === 1, "Catalog schemaVersion must be 1.");
  assert(isPlainObject(document.source), "Catalog requires source metadata.");
  for (const field of REQUIRED_SOURCE_FIELDS) assert(String(document.source[field] || "").trim(), `Catalog source requires ${field}.`);
  assert(GIT_SHA_PATTERN.test(document.source.repository?.resolvedRevision || ""), "Catalog source must include a pinned resolvedRevision.");
  assert(Array.isArray(document.models), "Catalog models must be an array.");
  const ids = new Set();
  for (const model of document.models) {
    assert(isPlainObject(model), "Catalog model must be an object.");
    assert(/^[a-z0-9][a-z0-9-]*$/.test(model.id || ""), `Invalid model id: ${model.id}`);
    assert(!ids.has(model.id), `Duplicate model id: ${model.id}`);
    ids.add(model.id);
    for (const field of ["name", "source", "author", "license", "licenseWarning", "licenseNote", "repositoryUrl", "skel"]) {
      assert(String(model[field] || "").trim(), `Model ${model.id} requires ${field}.`);
    }
    assert(/^https:\/\//.test(model.repositoryUrl), `Model ${model.id} repositoryUrl must use HTTPS.`);
    assert(extension(model.skel) === ".skel", `Model ${model.id} skel must be a .skel file.`);
    assert(SPINE_VERSION_PATTERN.test(model.spine?.min || "") && SPINE_VERSION_PATTERN.test(model.spine?.max || ""), `Model ${model.id} has invalid Spine compatibility.`);
    assert(Array.isArray(model.files) && model.files.length >= 3, `Model ${model.id} must include runtime files.`);
    const names = new Set();
    let hasAtlas = false;
    let hasTexture = false;
    let hasSkel = false;
    for (const file of model.files) {
      assert(isPlainObject(file), `Model ${model.id} has an invalid file entry.`);
      assert(!names.has(file.name), `Model ${model.id} repeats file ${file.name}.`);
      names.add(file.name);
      assert(SUPPORTED_EXTENSIONS.has(extension(file.name)), `Model ${model.id} has unsupported runtime file ${file.name}.`);
      assert(/^https:\/\//.test(file.url || ""), `Model ${model.id} file ${file.name} must use HTTPS.`);
      assert(SHA256_PATTERN.test(file.sha256 || "") || GIT_SHA_PATTERN.test(file.githubBlobSha || ""), `Model ${model.id} file ${file.name} requires an integrity digest.`);
      assert(Number.isSafeInteger(file.sizeBytes) && file.sizeBytes >= 0, `Model ${model.id} file ${file.name} requires sizeBytes.`);
      assert(GIT_SHA_PATTERN.test(file.githubBlobSha || ""), `Model ${model.id} file ${file.name} requires githubBlobSha.`);
      assert(Array.isArray(file.fallbackUrls) && file.fallbackUrls.every((url) => /^https:\/\//.test(url) && url !== file.url), `Model ${model.id} file ${file.name} has invalid fallback URLs.`);
      hasSkel ||= file.name === model.skel;
      hasAtlas ||= extension(file.name) === ".atlas";
      hasTexture ||= TEXTURE_EXTENSIONS.has(extension(file.name));
    }
    assert(hasSkel && hasAtlas && hasTexture, `Model ${model.id} must include its skel, atlas, and texture.`);
  }
  return document;
}

export async function generateCatalog({ sourcePath, outputPath, fetchImpl = fetch, localRoot = "" } = {}) {
  assert(sourcePath, "generateCatalog requires sourcePath.");
  const source = JSON.parse(await readFile(sourcePath, "utf8"));
  const document = await scanGithubRepository(source, { fetchImpl, localRoot });
  if (outputPath) await writeFile(outputPath, stableJson(document), "utf8");
  return document;
}

function parseArgs(args) {
  const result = { check: false, validate: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--check" || argument === "--validate") result[argument.slice(2)] = true;
    else if (argument === "--source" || argument === "--output" || argument === "--local-root") result[argument.slice(2).replace("-root", "Root")] = args[++index];
    else if (argument === "--help" || argument === "-h") result.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write("Usage: bun scripts/generate-ark-catalog.mjs [--source catalog/ark-source.json] [--output catalog/catalog.json] [--local-root path] [--check|--validate]\n");
    return;
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const sourcePath = path.resolve(root, args.source || "catalog/ark-source.json");
  const outputPath = path.resolve(root, args.output || "catalog/catalog.json");
  if (args.validate) {
    validateCatalog(JSON.parse(await readFile(outputPath, "utf8")));
    process.stdout.write(`Validated ${path.relative(root, outputPath)}.\n`);
    return;
  }
  const document = await generateCatalog({ sourcePath, localRoot: args.localRoot ? path.resolve(args.localRoot) : "" });
  const output = stableJson(document);
  if (args.check) {
    const current = await readFile(outputPath, "utf8");
    assert(current === output, `${path.relative(root, outputPath)} is not current; rerun the catalog generator.`);
  } else {
    await writeFile(outputPath, output, "utf8");
  }
  process.stdout.write(`Generated ${document.models.length} model entries and skipped ${document.skippedModels?.length || 0} invalid directories at ${path.relative(root, outputPath)}.\n`);
}

const invokedAsScript = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  main().catch((error) => {
    process.stderr.write(`Catalog generation failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
