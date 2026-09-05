import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function listFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(file));
    else if (entry.isFile()) files.push(file);
  }
  return files;
}

export function publishedAssetName(fileName) {
  return path.basename(fileName).replaceAll(" ", ".");
}

export async function stageReleaseAssets(root, stagingRoot) {
  const absoluteRoot = path.resolve(root);
  const absoluteStaging = path.resolve(stagingRoot);
  const files = await listFiles(absoluteRoot);
  if (files.length === 0) throw new Error(`No release files found under ${root}.`);

  const destinations = new Map();
  for (const file of files) {
    const sourceName = path.relative(absoluteRoot, file).split(path.sep).join("/");
    const publishedName = publishedAssetName(file);
    const collision = destinations.get(publishedName);
    if (collision) {
      throw new Error(`Release asset name collision after GitHub normalization: ${collision} and ${sourceName} both map to ${publishedName}.`);
    }
    destinations.set(publishedName, sourceName);
  }

  await rm(absoluteStaging, { recursive: true, force: true });
  await mkdir(absoluteStaging, { recursive: true });
  for (const file of files) {
    await cp(file, path.join(absoluteStaging, publishedAssetName(file)));
  }

  return {
    root: absoluteStaging,
    files: [...destinations.keys()].sort()
  };
}

export async function generateSha256Sums(root, outputPath) {
  const absoluteRoot = path.resolve(root);
  const absoluteOutput = path.resolve(outputPath);
  const files = (await listFiles(absoluteRoot))
    .filter((file) => path.resolve(file) !== absoluteOutput)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  if (files.length === 0) throw new Error(`No release files found under ${root}.`);

  const lines = [];
  for (const file of files) {
    const digest = createHash("sha256").update(await readFile(file)).digest("hex");
    const relative = path.relative(absoluteRoot, file).split(path.sep).join("/");
    lines.push(`${digest}  ${relative}`);
  }
  await writeFile(absoluteOutput, `${lines.join("\n")}\n`, "utf8");
  return {
    outputPath: absoluteOutput,
    files: files.map((file) => path.relative(absoluteRoot, file).split(path.sep).join("/"))
  };
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    if (process.argv[2] === "--stage") {
      const result = await stageReleaseAssets(process.argv[3] || "release-artifacts", process.argv[4] || "release-upload");
      console.log(`Staged ${result.files.length} release files under ${result.root}.`);
    } else {
      const result = await generateSha256Sums(process.argv[2] || "release-artifacts", process.argv[3] || "SHA256SUMS.txt");
      console.log(`Wrote ${result.outputPath} for ${result.files.length} release files.`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
