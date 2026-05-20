const fs = require("node:fs");
const path = require("node:path");

function listFiles(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function validateSpineAssetSelection(skelPath) {
  if (!skelPath || path.extname(skelPath).toLowerCase() !== ".skel") {
    throw new Error("Choose a Spine .skel file.");
  }
  if (!fs.existsSync(skelPath) || !fs.statSync(skelPath).isFile()) {
    throw new Error(`Spine skeleton file does not exist: ${skelPath}`);
  }

  const assetDir = path.dirname(skelPath);
  const files = listFiles(assetDir);
  const atlasFiles = files.filter((file) => path.extname(file).toLowerCase() === ".atlas");
  const pngFiles = files.filter((file) => path.extname(file).toLowerCase() === ".png");
  if (!atlasFiles.length || !pngFiles.length) {
    throw new Error("The selected .skel folder must also contain at least one .atlas file and one .png texture.");
  }

  return {
    assetDir,
    skel: path.basename(skelPath),
    atlasFiles,
    pngFiles
  };
}

function validateSpineAssetDir(assetDir, skel) {
  return validateSpineAssetSelection(path.join(assetDir, skel));
}

module.exports = {
  validateSpineAssetDir,
  validateSpineAssetSelection
};
