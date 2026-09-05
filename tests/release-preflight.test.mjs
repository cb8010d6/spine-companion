import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertReleaseCommitMatch,
  checkReleasePreflight,
  expectedReleaseArtifacts,
  validateArtifactMatrix
} from "../scripts/release-preflight.mjs";
import { generateSha256Sums, stageReleaseAssets } from "../scripts/generate-sha256sums.mjs";

const temporaryRoots = [];

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("release preflight", () => {
  it("accepts the exact tag, matching versions, notes, and built commit", async () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const { version } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    const result = checkReleasePreflight(root, { tag: `v${version}`, commit: "a".repeat(40) });
    expect(result.versions).toEqual({
      package: version,
      cargo: version,
      lock: version,
      tauri: version
    });
    expect(result.commit).toBe("a".repeat(40));
  });

  it("rejects a tag that is close but not exact", async () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const { version } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    expect(() => checkReleasePreflight(root, { tag: `v${version}-mismatch`, commit: "a".repeat(40) })).toThrow(/must equal/);
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

  it("requires the tag commit to equal the remote main commit", () => {
    const commit = "a".repeat(40);
    expect(assertReleaseCommitMatch({ tagCommit: commit, mainCommit: ` ${commit.toUpperCase()} ` })).toEqual({
      tagCommit: commit,
      mainCommit: commit
    });
    expect(() => assertReleaseCommitMatch({ tagCommit: commit, mainCommit: "b".repeat(40) })).toThrow(/does not match remote main/);
    expect(() => assertReleaseCommitMatch({ tagCommit: "short", mainCommit: commit })).toThrow(/not a full SHA/);
  });

  it("accepts exactly the five release artifacts", () => {
    const tag = "v0.2.6-rc.11";
    const expected = expectedReleaseArtifacts(tag);
    expect(expected).toEqual([
      "Spine Companion_0.2.6-rc.11_x64-setup.exe",
      "Spine Companion_0.2.6-rc.11_amd64.AppImage",
      "Spine Companion_0.2.6-rc.11_amd64.deb",
      "Spine Companion_0.2.6-rc.11_x64.dmg",
      "Spine Companion_0.2.6-rc.11_aarch64.dmg"
    ]);
    expect(validateArtifactMatrix(expected.map((name) => `nested/${name}`), tag).actual).toEqual([...expected].sort());
  });

  it("rejects missing, duplicate, and extra release artifacts", () => {
    const tag = "v0.2.6-rc.11";
    const expected = expectedReleaseArtifacts(tag);
    expect(() => validateArtifactMatrix(expected.slice(1), tag)).toThrow(/Missing/);
    expect(() => validateArtifactMatrix([...expected, expected[0]], tag)).toThrow(/unexpected/);
    expect(() => validateArtifactMatrix([...expected.slice(0, -1), "notes.txt"], tag)).toThrow(/notes\.txt/);
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

  it("stages release files with the basenames published by gh and hashes those names", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spine-release-published-names-"));
    temporaryRoots.push(root);
    const artifacts = path.join(root, "release-artifacts");
    const staged = path.join(root, "release-upload");
    await mkdir(path.join(artifacts, "windows"), { recursive: true });
    await mkdir(path.join(artifacts, "linux"), { recursive: true });
    await writeFile(path.join(artifacts, "windows", "Spine Companion_1.2.3_x64-setup.exe"), "windows");
    await writeFile(path.join(artifacts, "linux", "Spine Companion_1.2.3_amd64.deb"), "linux");

    await expect(stageReleaseAssets(artifacts, staged)).resolves.toMatchObject({
      files: ["Spine.Companion_1.2.3_amd64.deb", "Spine.Companion_1.2.3_x64-setup.exe"]
    });
    expect((await readdir(staged)).sort()).toEqual([
      "Spine.Companion_1.2.3_amd64.deb",
      "Spine.Companion_1.2.3_x64-setup.exe"
    ]);

    const output = path.join(root, "SHA256SUMS.txt");
    const result = await generateSha256Sums(staged, output);
    expect(result.files).toEqual([
      "Spine.Companion_1.2.3_amd64.deb",
      "Spine.Companion_1.2.3_x64-setup.exe"
    ]);
    await expect(readFile(output, "utf8")).resolves.toMatch(/  Spine\.Companion_1\.2\.3_amd64\.deb\n.*  Spine\.Companion_1\.2\.3_x64-setup\.exe/s);
  });

  it("rejects release files that collide after GitHub name normalization", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spine-release-published-collision-"));
    temporaryRoots.push(root);
    const artifacts = path.join(root, "release-artifacts");
    await mkdir(path.join(artifacts, "one"), { recursive: true });
    await mkdir(path.join(artifacts, "two"), { recursive: true });
    await writeFile(path.join(artifacts, "one", "Spine Companion.zip"), "one");
    await writeFile(path.join(artifacts, "two", "Spine.Companion.zip"), "two");

    await expect(stageReleaseAssets(artifacts, path.join(root, "release-upload"))).rejects.toThrow(/collision after GitHub normalization/iu);
  });

  it("rejects overlapping or dirty staging paths without deleting source files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spine-release-staging-safety-"));
    temporaryRoots.push(root);
    const artifacts = path.join(root, "release-artifacts");
    await mkdir(artifacts, { recursive: true });
    const source = path.join(artifacts, "asset.bin");
    await writeFile(source, "asset");

    await expect(stageReleaseAssets(artifacts, artifacts)).rejects.toThrow(/must not overlap/iu);
    await expect(readFile(source, "utf8")).resolves.toBe("asset");
    await expect(stageReleaseAssets(artifacts, root)).rejects.toThrow(/must not overlap/iu);
    await expect(readdir(root)).resolves.toContain("release-artifacts");

    const dirtyStaging = path.join(root, "release-upload");
    const sentinel = path.join(dirtyStaging, "sentinel.txt");
    await mkdir(dirtyStaging, { recursive: true });
    await writeFile(sentinel, "keep");
    await expect(stageReleaseAssets(artifacts, dirtyStaging)).rejects.toThrow(/absent or empty/iu);
    await expect(readFile(sentinel, "utf8")).resolves.toBe("keep");
  });
});

describe("release workflow contract", () => {
  it("keeps manual candidate validation non-publishing and toolchains reproducible", async () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const release = await readFile(path.join(root, ".github", "workflows", "release.yml"), "utf8");
    const ci = await readFile(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
    const toolchain = await readFile(path.join(root, "rust-toolchain.toml"), "utf8");
    const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    const bunVersion = packageJson.packageManager.split("@")[1];
    const rustVersion = toolchain.match(/^channel = "([^"]+)"/mu)[1];

    expect(release.slice(release.indexOf("\n  publish:"))).toContain("if: github.event_name == 'push' && github.ref_type == 'tag'");
    expect(release).toContain("${{ needs.validate.outputs.tag }}");
    const stageIndex = release.indexOf("bun scripts/generate-sha256sums.mjs --stage release-artifacts release-upload");
    const createIndex = release.indexOf('gh release create "$TAG"');
    expect(stageIndex).toBeGreaterThan(-1);
    expect(createIndex).toBeGreaterThan(stageIndex);
    for (const workflow of [ci, release]) {
      const bunPins = [...workflow.matchAll(/bun-version:\s*(\S+)/gu)].map((match) => match[1]);
      const rustPins = [...workflow.matchAll(/toolchain:\s*(\S+)/gu)].map((match) => match[1]);
      expect(bunPins.length).toBeGreaterThan(0);
      expect(bunPins.every((version) => version === bunVersion)).toBe(true);
      expect(rustPins.length).toBeGreaterThan(0);
      expect(rustPins.every((version) => version === rustVersion)).toBe(true);
      for (const match of workflow.matchAll(/run: (bun install[^\n]*)/gu)) expect(match[1]).toContain("--frozen-lockfile");
      for (const command of ["bun run lint", "bun run type-check", "cargo fmt --all --check", "cargo clippy --locked --all-targets -- -D warnings", "cargo test --locked"]) expect(workflow).toContain(command);
    }
  });

  it("smoke-tests the installed Windows package without publishing the raw executable", async () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const workflow = await readFile(path.join(root, ".github", "workflows", "release.yml"), "utf8");
    const artifactUpload = workflow.slice(
      workflow.indexOf("- uses: actions/upload-artifact@"),
      workflow.indexOf("\n  publish:")
    );

    expect(workflow).toContain("gh release download v0.2.6-rc.10");
    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow).toContain("git ls-remote --refs origin refs/heads/main");
    expect(workflow).toContain('refs/tags/${TAG}^{commit}');
    expect(workflow).toContain("--tag-commit");
    expect(workflow).toContain("--main-commit");
    expect(workflow).toContain("--artifacts release-artifacts");
    expect(workflow).toContain("--stage release-artifacts release-upload");
    expect(workflow).toContain("release-upload SHA256SUMS.txt");
    expect(workflow).toContain("find release-upload -type f -print0");
    expect(workflow).toContain("-PreviousInstallerPath $previous");
    expect(workflow).toContain('-PreviousInstallerSha256 "844049CC7F6478F6FEE6C0AF1AD50E7215F0D68DEF73293815837AF78A3292B1"');
    expect(artifactUpload).toContain("src-tauri/target/release/bundle/**/*.exe");
    expect(artifactUpload).not.toContain("src-tauri/target/release/spine-companion.exe");
  });

  it("runs the Windows installer lifecycle smoke during pull request CI", async () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const workflow = await readFile(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
    const smoke = await readFile(path.join(root, "scripts", "test-windows-installer.ps1"), "utf8");

    expect(workflow).toContain("windows-package-smoke:");
    expect(workflow).toContain("bunx tauri build --bundles nsis");
    expect(workflow).toContain("gh release download v0.2.6-rc.10");
    expect(workflow).toContain("-PreviousInstallerPath $previous");
    expect(workflow).toContain('-PreviousInstallerSha256 "844049CC7F6478F6FEE6C0AF1AD50E7215F0D68DEF73293815837AF78A3292B1"');
    expect(smoke).toContain('[string] $PreviousInstallerPath');
    expect(smoke).toContain("Get-FileHash -LiteralPath $previousInstaller -Algorithm SHA256");
    expect(smoke).toContain('Start-Process -FilePath $PackagePath -ArgumentList @("/S", "/D=$installDir") -WindowStyle Hidden');
    expect(smoke).toContain('if ($previousInstaller)');
    expect(smoke).toContain('$env:APPDATA = $appDataRoot');
    expect(smoke).toContain('Start-Process -FilePath $UninstallerPath -ArgumentList "/S" -WindowStyle Hidden');
    expect(smoke).toContain('$transientDllInitializationFailure = -1073741502');
    expect(smoke).toContain('for ($attempt = 1; $attempt -le 2; $attempt++)');
    expect(smoke).toContain("bun scripts/check-packaged-mcp.mjs $exe");
    const packagedMcp = await readFile(path.join(root, "scripts", "check-packaged-mcp.mjs"), "utf8");
    expect(packagedMcp).toContain("client.getServerVersion()?.version");
    expect(packagedMcp).toContain("serverVersion !== expectedVersion");
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
