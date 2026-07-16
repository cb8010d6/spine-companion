import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("lazy Spine preview runtime", () => {
  it.each(["panel.js", "manager.js"])("loads spine-preview on demand from %s", (file) => {
    const source = readFileSync(new URL(`../src/renderer/${file}`, import.meta.url), "utf8");
    expect(source).not.toMatch(/import\s+\{\s*renderSpinePreview\s*\}\s+from\s+["']\.\/spine-preview\.js["']/);
    expect(source.match(/import\(["']\.\/spine-preview\.js["']\)/g)).toHaveLength(1);
    expect(source).toContain("spinePreviewModulePromise ||=");
  });
});
