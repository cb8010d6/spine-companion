#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const source = path.join(rootDir, "skills", "spine-companion-status");
const targetRoot = process.env.CODEX_HOME
  ? path.join(process.env.CODEX_HOME, "skills")
  : path.join(os.homedir(), ".codex", "skills");
const target = path.join(targetRoot, "spine-companion-status");

if (!fs.existsSync(source)) {
  throw new Error(`Skill source not found: ${source}`);
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyDir(src, dst);
    } else {
      fs.copyFileSync(src, dst);
    }
  }
}

copyDir(source, target);
console.log(`Installed skill to ${target}`);
console.log("Restart Codex or open a new session for the skill metadata to refresh.");
