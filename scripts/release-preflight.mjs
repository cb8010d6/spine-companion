import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(scriptRoot, "..");
const fullShaPattern = /^[0-9a-f]{40}$/iu;

export function assertReleaseCommitMatch({ tagCommit, mainCommit } = {}) {
  const normalizedTagCommit = typeof tagCommit === "string" ? tagCommit.trim() : "";
  const normalizedMainCommit = typeof mainCommit === "string" ? mainCommit.trim() : "";
  const invalid = [];

  if (!fullShaPattern.test(normalizedTagCommit)) invalid.push(`tag commit is not a full SHA: ${normalizedTagCommit || "<empty>"}`);
  if (!fullShaPattern.test(normalizedMainCommit)) invalid.push(`remote main commit is not a full SHA: ${normalizedMainCommit || "<empty>"}`);
  if (invalid.length) throw new Error(invalid.join("; "));
  if (normalizedTagCommit.toLowerCase() !== normalizedMainCommit.toLowerCase()) {
    throw new Error(`tag commit ${normalizedTagCommit} does not match remote main commit ${normalizedMainCommit}`);
  }

  return {
    tagCommit: normalizedTagCommit.toLowerCase(),
    mainCommit: normalizedMainCommit.toLowerCase()
  };
}

export function expectedReleaseArtifacts(tag) {
  const version = typeof tag === "string" && /^v[^/]+$/u.test(tag) ? tag.slice(1) : null;
  if (!version) throw new Error(`Release artifact validation requires a version tag, got ${tag || "<empty>"}.`);

  return [
    `Spine.Companion_${version}_x64-setup.exe`,
    `Spine.Companion_${version}_amd64.AppImage`,
    `Spine.Companion_${version}_amd64.deb`,
    `Spine.Companion_${version}_x64.dmg`,
    `Spine.Companion_${version}_aarch64.dmg`
  ];
}

function multisetDifference(left, right) {
  const rightCounts = new Map();
  for (const value of right) rightCounts.set(value, (rightCounts.get(value) || 0) + 1);
  const difference = [];
  for (const value of left) {
    const count = rightCounts.get(value) || 0;
    if (count > 0) rightCounts.set(value, count - 1);
    else difference.push(value);
  }
  return difference;
}

export function validateArtifactMatrix(fileNames, tag) {
  const actual = fileNames.map((fileName) => path.basename(fileName)).sort();
  const expected = expectedReleaseArtifacts(tag).sort();
  const missing = multisetDifference(expected, actual);
  const unexpected = multisetDifference(actual, expected);

  if (missing.length || unexpected.length || actual.length !== expected.length) {
    const missingText = missing.length ? missing.join(", ") : "none";
    const unexpectedText = unexpected.length ? unexpected.join(", ") : "none";
    throw new Error(`Artifact matrix mismatch for ${tag}. Missing: ${missingText}; unexpected: ${unexpectedText}.`);
  }

  return { expected, actual };
}

export function listArtifactFiles(root) {
  if (!existsSync(root)) throw new Error(`Artifact directory not found: ${root}.`);
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() || entry.isSymbolicLink()) files.push(path.relative(root, absolute));
    }
  };
  visit(root);
  return files;
}

export function validateArtifactDirectory(root, tag) {
  return validateArtifactMatrix(listArtifactFiles(root), tag);
}

function readPackageVersion(cargoText) {
  const match = cargoText.match(/^\s*version\s*=\s*"([^"]+)"/m);
  return match?.[1] || null;
}

function readLockPackageVersion(lockText, packageName) {
  const block = lockText
    .split(/\[\[package\]\]/u)
    .find((section) => new RegExp(`^name = "${packageName}"$`, "mu").test(section));
  return block?.match(/^version = "([^"]+)"$/mu)?.[1] || null;
}

export function resolveReleaseTag({ tag, env = process.env } = {}) {
  if (tag) return tag;
  if (env.GITHUB_REF_NAME) return env.GITHUB_REF_NAME;
  if (env.GITHUB_REF?.startsWith("refs/tags/")) return env.GITHUB_REF.slice("refs/tags/".length);
  return null;
}

export function getBuiltCommit(root, providedCommit) {
  if (providedCommit) return providedCommit.trim();
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
}

export function checkReleasePreflight(root = defaultRoot, options = {}) {
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const cargoVersion = readPackageVersion(readFileSync(path.join(root, "src-tauri", "Cargo.toml"), "utf8"));
  const lockVersion = readLockPackageVersion(readFileSync(path.join(root, "src-tauri", "Cargo.lock"), "utf8"), "spine-companion");
  const tauriVersion = JSON.parse(readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf8")).version;
  const tag = resolveReleaseTag(options);
  const errors = [];
  const versions = {
    package: packageJson.version,
    cargo: cargoVersion,
    lock: lockVersion,
    tauri: tauriVersion
  };

  if (!tag) errors.push("Release tag is required; pass --tag vX.Y.Z.");
  if (tag && tag !== `v${packageJson.version}`) {
    errors.push(`Release tag ${tag} must equal v${packageJson.version}.`);
  }
  if (Object.values(versions).some((version) => !version || version !== packageJson.version)) {
    errors.push(`Package/Cargo/Cargo.lock/Tauri versions must match: ${JSON.stringify(versions)}.`);
  }

  const notesPath = tag ? path.join(root, "docs", "releases", `release-notes-${tag}.md`) : null;
  if (notesPath && !existsSync(notesPath)) errors.push(`Release notes not found: ${path.relative(root, notesPath)}.`);

  let commit = null;
  try {
    commit = getBuiltCommit(root, options.commit);
  } catch (error) {
    errors.push(`Unable to resolve built commit: ${error.message}`);
  }
  if (commit && !/^[0-9a-f]{40}$/iu.test(commit)) errors.push(`Built commit is not a full SHA: ${commit}.`);

  let releaseCommits = null;
  if (options.tagCommit !== undefined || options.mainCommit !== undefined) {
    try {
      releaseCommits = assertReleaseCommitMatch({ tagCommit: options.tagCommit, mainCommit: options.mainCommit });
    } catch (error) {
      errors.push(`Tag/main commit check failed: ${error.message}.`);
    }
  }

  let artifacts = null;
  if (options.artifacts) {
    try {
      artifacts = validateArtifactDirectory(path.resolve(root, options.artifacts), tag);
    } catch (error) {
      errors.push(error.message);
    }
  }

  if (errors.length) {
    throw new Error(["Release preflight failed:", ...errors.map((error) => `- ${error}`)].join("\n"));
  }

  return {
    tag,
    versions,
    notesPath,
    commit,
    tagCommit: releaseCommits?.tagCommit || null,
    mainCommit: releaseCommits?.mainCommit || null,
    artifacts
  };
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const result = checkReleasePreflight(argumentValue("--root") || defaultRoot, {
      tag: argumentValue("--tag"),
      tagCommit: argumentValue("--tag-commit"),
      mainCommit: argumentValue("--main-commit"),
      artifacts: argumentValue("--artifacts")
    });
    console.log(`Release preflight passed: ${result.tag}`);
    console.log(`Versions: ${JSON.stringify(result.versions)}`);
    console.log(`Release notes: ${path.relative(defaultRoot, result.notesPath)}`);
    console.log(`Built commit: ${result.commit}`);
    if (result.tagCommit) console.log(`Tag/main commit: ${result.tagCommit}`);
    if (result.artifacts) console.log(`Artifacts: ${result.artifacts.actual.join(", ")}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
