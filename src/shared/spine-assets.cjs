const fs = require("node:fs");
const path = require("node:path");

function listFiles(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function atlasTextureRefs(text) {
  return String(text || "")
    .split(/\r?\n/)
    .filter((line) => /^[^\s].+\.(png|jpe?g|webp)\s*$/i.test(line))
    .map((line) => line.trim());
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
  const missingTextures = [];
  for (const atlas of atlasFiles) {
    const atlasPath = path.join(assetDir, atlas);
    let refs = [];
    try {
      refs = atlasTextureRefs(fs.readFileSync(atlasPath, "utf8"));
    } catch (error) {
      throw new Error(`Unable to read Spine atlas file ${atlas}: ${error.message || String(error)}`);
    }
    for (const ref of refs) {
      const texturePath = path.join(assetDir, ref);
      if (!fs.existsSync(texturePath) || !fs.statSync(texturePath).isFile()) {
        missingTextures.push(`${atlas} -> ${ref}`);
      }
    }
  }
  if (missingTextures.length) {
    throw new Error(`Missing atlas texture file(s): ${missingTextures.join(", ")}`);
  }

  return {
    assetDir,
    skel: path.basename(skelPath),
    atlasFiles,
    pngFiles,
    atlasTextureRefs: atlasFiles.flatMap((atlas) => atlasTextureRefs(fs.readFileSync(path.join(assetDir, atlas), "utf8")))
  };
}

function validateSpineAssetDir(assetDir, skel) {
  return validateSpineAssetSelection(path.join(assetDir, skel));
}

module.exports = {
  atlasTextureRefs,
  validateSpineAssetDir,
  validateSpineAssetSelection
};
