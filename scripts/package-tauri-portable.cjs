const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const rootDir = path.resolve(__dirname, "..");
const outDir = path.join(rootDir, "release", "Spine Companion Portable");
const zipPath = path.join(rootDir, "release", "Spine Companion Portable.zip");
const exePath = path.join(rootDir, "src-tauri", "target", "release", "spine-companion.exe");
const model = {
  id: "ark-1001-amiya2-sale-16",
  skel: "build_char_1001_amiya2_sale#16.skel",
  files: [
    {
      name: "build_char_1001_amiya2_sale#16.atlas",
      url: "https://raw.githubusercontent.com/isHarryh/Ark-Models/main/models/1001_amiya2_sale%2316/build_char_1001_amiya2_sale%2316.atlas"
    },
    {
      name: "build_char_1001_amiya2_sale#16.png",
      url: "https://raw.githubusercontent.com/isHarryh/Ark-Models/main/models/1001_amiya2_sale%2316/build_char_1001_amiya2_sale%2316.png"
    },
    {
      name: "build_char_1001_amiya2_sale#16.skel",
      url: "https://raw.githubusercontent.com/isHarryh/Ark-Models/main/models/1001_amiya2_sale%2316/build_char_1001_amiya2_sale%2316.skel"
    }
  ]
};

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

async function download(url, file) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
}

(async () => {
  if (!process.argv.includes("--skip-build")) {
    run("bun", ["run", "tauri:build"]);
  }
  if (!fs.existsSync(exePath)) {
    throw new Error(`Tauri executable not found: ${exePath}`);
  }

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.copyFileSync(exePath, path.join(outDir, "Spine Companion.exe"));

  const modelDir = path.join(outDir, "models", model.id);
  fs.mkdirSync(modelDir, { recursive: true });
  for (const file of model.files) {
    await download(file.url, path.join(modelDir, file.name));
  }

  fs.writeFileSync(
    path.join(outDir, "companion.local.json"),
    `${JSON.stringify({
      spine: {
        assetDir: "models/ark-1001-amiya2-sale-16",
        skel: model.skel
      }
    }, null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(outDir, "README.zh-CN.txt"),
    [
      "Spine Companion Portable",
      "",
      "双击 Spine Companion.exe 即可启动。",
      "models/ 中的 Ark-Models 素材仅供本地测试使用，请不要重新分发。",
      "如果模型未显示，检查 companion.local.json 中的 assetDir 是否仍指向 models/ark-1001-amiya2-sale-16。"
    ].join("\r\n")
  );
  if (process.platform === "win32") {
    fs.rmSync(zipPath, { force: true });
    run("powershell", [
      "-NoProfile",
      "-Command",
      `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('${outDir.replace(/'/g, "''")}', '${zipPath.replace(/'/g, "''")}')`
    ]);
  }
  console.log(`Portable folder written to ${outDir}`);
  if (fs.existsSync(zipPath)) console.log(`Portable zip written to ${zipPath}`);
})();
