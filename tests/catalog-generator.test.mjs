import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scanGithubRepository, validateCatalog } from "../scripts/generate-ark-catalog.mjs";

const REVISION = "0123456789abcdef0123456789abcdef01234567";
const BLOB_SHA = "a".repeat(40);
const source = {
  id: "fixture-models",
  name: "Fixture Models",
  author: "Fixture upstream author",
  license: "NOASSERTION",
  licenseWarning: "Review upstream license terms before use.",
  licenseNote: "Do not redistribute third-party runtime assets.",
  repository: { owner: "fixture", name: "models", ref: "main", modelsPath: "models" },
  spine: { min: "3.8.0", max: "3.8.99" },
  tags: ["fixture", "third-party"]
};

const bytes = {
  "models/1001_alpha/alpha.atlas": Buffer.from("atlas"),
  "models/1001_alpha/alpha.png": Buffer.from([1, 2, 3]),
  "models/1001_alpha/alpha.skel": Buffer.from([4, 5, 6, 7, ...Buffer.from("3.8.99")])
};

function mockFetch(treePaths = Object.keys(bytes)) {
  return async (url) => {
    if (url === "https://api.github.com/repos/fixture/models") {
      return Response.json({ html_url: "https://github.com/fixture/models" });
    }
    if (url === "https://api.github.com/repos/fixture/models/commits/main") return Response.json({ sha: REVISION });
    if (url === `https://api.github.com/repos/fixture/models/git/trees/${REVISION}?recursive=1`) {
      return Response.json({
        truncated: false,
        tree: treePaths.map((file) => ({ type: "blob", path: file, sha: BLOB_SHA, size: bytes[file].length }))
      });
    }
    const matched = url.match(new RegExp(`^https://(?:raw\\.githubusercontent\\.com/fixture/models/${REVISION}|cdn\\.jsdelivr\\.net/gh/fixture/models@${REVISION})/(.+)$`));
    if (matched) return new Response(bytes[decodeURIComponent(matched[1])]);
    return new Response("not found", { status: 404 });
  };
}

describe("Ark catalog generator", () => {
  it("validates the committed catalog without contacting GitHub", async () => {
    for (const name of ["catalog.json", "illustrations.json", "enemies.json"]) {
      const catalogPath = fileURLToPath(new URL(`../catalog/${name}`, import.meta.url));
      const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
      expect(validateCatalog(catalog)).toBe(catalog);
    }
  });

  it("creates deterministic, commit-pinned metadata with SHA-256 digests", async () => {
    const first = await scanGithubRepository(source, { fetchImpl: mockFetch() });
    const second = await scanGithubRepository(source, { fetchImpl: mockFetch(Object.keys(bytes).reverse()) });

    expect(first).toEqual(second);
    expect(first.source.repository.resolvedRevision).toBe(REVISION);
    expect(first.models).toHaveLength(1);
    expect(first.models[0]).toMatchObject({
      id: "fixture-models-1001-alpha",
      skel: "alpha.skel",
      spine: { min: "3.8.99", max: "3.8.99" },
      license: "NOASSERTION"
    });
    expect(first.models[0].files).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "alpha.skel",
        sha256: createHash("sha256").update(bytes["models/1001_alpha/alpha.skel"]).digest("hex"),
        sizeBytes: bytes["models/1001_alpha/alpha.skel"].length,
        githubBlobSha: BLOB_SHA,
        fallbackUrls: [`https://cdn.jsdelivr.net/gh/fixture/models@${REVISION}/models/1001_alpha/alpha.skel`],
        url: `https://raw.githubusercontent.com/fixture/models/${REVISION}/models/1001_alpha/alpha.skel`
      })
    ]));
  });

  it("rejects catalog entries that omit an integrity digest", async () => {
    const catalog = await scanGithubRepository(source, { fetchImpl: mockFetch() });
    catalog.models[0].files[0].sha256 = "";
    catalog.models[0].files[0].githubBlobSha = "";
    expect(() => validateCatalog(catalog)).toThrow("requires an integrity digest");
  });

  it("can generate a metadata-only catalog backed by immutable Git blob digests", async () => {
    const catalog = await scanGithubRepository({
      ...source,
      metadataOnly: true,
      requireDetectedSpineVersion: false,
      category: "illustration",
      compatibilityProfile: "idle-only"
    }, { fetchImpl: mockFetch() });
    expect(catalog.models[0]).toMatchObject({
      category: "illustration",
      compatibilityProfile: "idle-only",
      versionVerified: false,
      spine: source.spine
    });
    expect(catalog.models[0].files[0]).not.toHaveProperty("sha256");
    expect(catalog.models[0].files[0].githubBlobSha).toBe(BLOB_SHA);
    expect(validateCatalog(catalog)).toBe(catalog);
  });

  it("can verify only the Spine header for metadata-only catalogs", async () => {
    const catalog = await scanGithubRepository({
      ...source,
      metadataOnly: true,
      verifySpineHeaders: true,
      requireDetectedSpineVersion: true,
      category: "enemy",
      compatibilityProfile: "experimental"
    }, { fetchImpl: mockFetch() });
    expect(catalog.models[0]).toMatchObject({
      versionVerified: true,
      spine: { min: "3.8.99", max: "3.8.99" }
    });
    expect(catalog.models[0].files[0]).not.toHaveProperty("sha256");
  });

  it("skips incomplete runtime folders without blocking valid catalog entries", async () => {
    const catalog = await scanGithubRepository(source, {
      fetchImpl: mockFetch(["models/1001_alpha/alpha.skel", "models/1001_alpha/alpha.png"])
    });
    expect(catalog.models).toHaveLength(0);
    expect(catalog.skippedModels).toEqual([
      expect.objectContaining({ directory: "1001_alpha", reason: expect.stringContaining("missing .atlas") })
    ]);
  });
});
