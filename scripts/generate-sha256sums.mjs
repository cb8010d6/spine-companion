import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
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
    const result = await generateSha256Sums(process.argv[2] || "release-artifacts", process.argv[3] || "SHA256SUMS.txt");
    console.log(`Wrote ${result.outputPath} for ${result.files.length} release files.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
