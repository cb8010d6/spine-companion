const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const url = process.env.PREVIEW_URL || process.argv[2] || "http://127.0.0.1:17389?api=http://127.0.0.1:17388";
const output = path.resolve(process.env.PREVIEW_OUTPUT || process.argv[3] || "out/preview.png");
const waitMs = Number(process.env.PREVIEW_WAIT_MS || process.argv[4] || 3000);
const logs = [];

async function main() {
  await app.whenReady();
  const win = new BrowserWindow({
    width: 420,
    height: 520,
    show: false,
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: {
      offscreen: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.webContents.on("console-message", (_event, level, message) => {
    logs.push({ level, message });
  });

  await win.loadURL(url);
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const image = await win.webContents.capturePage();
  fs.writeFileSync(output, image.toPNG());

  const errors = logs.filter((entry) => {
    if (entry.message.includes("Electron Security Warning")) return false;
    if (entry.message.includes("PixiJS Deprecation Warning")) return false;
    return entry.level >= 3 || /\b(error|failed|uncaught|exception)\b/i.test(entry.message);
  });
  console.log(JSON.stringify({ url, output, errors, logs }, null, 2));
  win.close();
  app.quit();
}

main().catch((error) => {
  console.error(error);
  app.quit();
  process.exit(1);
});
