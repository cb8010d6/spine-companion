import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { checkReleasePreflight } from "../scripts/release-preflight.mjs";
import { generateSha256Sums } from "../scripts/generate-sha256sums.mjs";

const temporaryRoots = [];

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("release preflight", () => {
  it("accepts the exact tag, matching versions, notes, and built commit", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const result = checkReleasePreflight(root, { tag: "v0.2.6-rc.10", commit: "a".repeat(40) });
    expect(result.versions).toEqual({
      package: "0.2.6-rc.10",
      cargo: "0.2.6-rc.10",
      lock: "0.2.6-rc.10",
      tauri: "0.2.6-rc.10"
    });
    expect(result.commit).toBe("a".repeat(40));
  });

  it("rejects a tag that is close but not exact", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    expect(() => checkReleasePreflight(root, { tag: "v0.2.6-rc.9", commit: "a".repeat(40) })).toThrow(/must equal/);
  });

  it("rejects a missing release note", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spine-release-preflight-"));
    temporaryRoots.push(root);
    await mkdir(path.join(root, "src-tauri"), { recursive: true });
    await mkdir(path.join(root, "docs", "releases"), { recursive: true });
    await writeFile(path.join(root, "package.json"), JSON.stringify({ version: "1.2.3" }));
    await writeFile(path.join(root, "src-tauri", "Cargo.toml"), 'version = "1.2.3"\n');
    await writeFile(path.join(root, "src-tauri", "Cargo.lock"), '[[package]]\nname = "spine-companion"\nversion = "1.2.3"\n');
    await writeFile(path.join(root, "src-tauri", "tauri.conf.json"), JSON.stringify({ version: "1.2.3" }));
    expect(() => checkReleasePreflight(root, { tag: "v1.2.3", commit: "a".repeat(40) })).toThrow(/Release notes not found/);
  });
});

describe("release checksums", () => {
  it("writes sorted SHA256 entries scoped to the artifact directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spine-release-checksums-"));
    temporaryRoots.push(root);
    const artifacts = path.join(root, "release-artifacts");
    await mkdir(path.join(artifacts, "nested"), { recursive: true });
    await writeFile(path.join(artifacts, "z.bin"), "z");
    await writeFile(path.join(artifacts, "nested", "a.bin"), "a");
    const output = path.join(root, "SHA256SUMS.txt");
    const result = await generateSha256Sums(artifacts, output);
    expect(result.files).toEqual(["nested/a.bin", "z.bin"]);
    await expect(readFile(output, "utf8")).resolves.toMatch(/  nested\/a\.bin\n.*  z\.bin/s);
  });
});

describe("release workflow contract", () => {
  it("smoke-tests the packaged Windows binary without publishing the raw executable", async () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const workflow = await readFile(path.join(root, ".github", "workflows", "release.yml"), "utf8");
    const artifactUpload = workflow.slice(
      workflow.indexOf("- uses: actions/upload-artifact@"),
      workflow.indexOf("\n  publish:")
    );

    expect(workflow).toContain("bun scripts/check-packaged-mcp.mjs $exe");
    expect(artifactUpload).toContain("src-tauri/target/release/bundle/**/*.exe");
    expect(artifactUpload).not.toContain("src-tauri/target/release/spine-companion.exe");
  });

  it("pins every third-party action to a full commit SHA", async () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    for (const file of ["ci.yml", "release.yml"]) {
      const workflow = await readFile(path.join(root, ".github", "workflows", file), "utf8");
      const actions = [...workflow.matchAll(/^\s*- uses:\s+([^\s#]+)/gmu)].map((match) => match[1]);
      expect(actions.length).toBeGreaterThan(0);
      expect(actions.every((action) => /@[0-9a-f]{40}$/u.test(action))).toBe(true);
    }
  });
});
