import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(scriptRoot, "..");

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

  if (errors.length) {
    throw new Error(["Release preflight failed:", ...errors.map((error) => `- ${error}`)].join("\n"));
  }

  return { tag, versions, notesPath, commit };
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const result = checkReleasePreflight(argumentValue("--root") || defaultRoot, {
      tag: argumentValue("--tag")
    });
    console.log(`Release preflight passed: ${result.tag}`);
    console.log(`Versions: ${JSON.stringify(result.versions)}`);
    console.log(`Release notes: ${path.relative(defaultRoot, result.notesPath)}`);
    console.log(`Built commit: ${result.commit}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
