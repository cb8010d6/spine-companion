const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const localConfigPath = path.join(rootDir, "companion.local.json");

function fail(message) {
  console.error(message);
  process.exit(1);
}

const assetDirArg = process.argv[2];
const skelArg = process.argv[3];

if (!assetDirArg) {
  fail("Usage: npm run setup:assets -- <spine-folder> [model.skel]");
}

const assetDir = path.resolve(assetDirArg);
if (!fs.existsSync(assetDir) || !fs.statSync(assetDir).isDirectory()) {
  fail(`Spine folder does not exist: ${assetDir}`);
}

const files = fs.readdirSync(assetDir);
const skel = skelArg || files.find((file) => file.toLowerCase().endsWith(".skel"));
if (!skel) fail("No .skel file found. Pass the .skel filename as the second argument.");

const atlasFiles = files.filter((file) => file.toLowerCase().endsWith(".atlas"));
const imageFiles = files.filter((file) => /\.(png|webp|jpg|jpeg)$/i.test(file));

if (!fs.existsSync(path.join(assetDir, skel))) fail(`Missing skeleton file: ${skel}`);
if (atlasFiles.length === 0) fail("No .atlas file found in the Spine folder.");
if (imageFiles.length === 0) fail("No texture image found in the Spine folder.");

const config = {
  spine: {
    assetDir,
    skel
  }
};

fs.writeFileSync(localConfigPath, JSON.stringify(config, null, 2) + "\n");
console.log(`Wrote ${localConfigPath}`);
console.log(`Using ${path.join(assetDir, skel)}`);
