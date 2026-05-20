import { describe, expect, it } from "vitest";

const { checkGitHubRelease, compareVersions, selectReleaseAsset } = require("../src/shared/update-checker.cjs");

describe("update-checker", () => {
  it("compares semver-like versions", () => {
    expect(compareVersions("0.2.1", "0.2.0")).toBe(1);
    expect(compareVersions("v0.2.0", "0.2.0")).toBe(0);
    expect(compareVersions("0.1.9", "0.2.0")).toBe(-1);
  });

  it("reports update availability from GitHub release response", async () => {
    const result = await checkGitHubRelease({
      currentVersion: "0.2.0",
      platform: "win32",
      arch: "x64",
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          tag_name: "v0.2.1",
          html_url: "https://example.test",
          name: "v0.2.1",
          assets: [
            { name: "Spine.Companion_0.2.1_x64_en-US.msi", browser_download_url: "https://example.test/app.msi" },
            { name: "Spine.Companion_0.2.1_x64-setup.exe", browser_download_url: "https://example.test/setup.exe" }
          ]
        })
      })
    });
    expect(result.updateAvailable).toBe(true);
    expect(result.latestVersion).toBe("0.2.1");
    expect(result.recommendedAsset.name).toContain("setup.exe");
    expect(result.downloadUrl).toBe("https://example.test/setup.exe");
  });

  it("selects platform-specific release assets", () => {
    const assets = [
      { name: "Spine.Companion_0.2.1_aarch64.dmg", browser_download_url: "https://example.test/mac-arm.dmg" },
      { name: "Spine.Companion_0.2.1_amd64.AppImage", browser_download_url: "https://example.test/linux.AppImage" },
      { name: "Spine.Companion_0.2.1_x64-setup.exe", browser_download_url: "https://example.test/win.exe" }
    ];

    expect(selectReleaseAsset(assets, "darwin", "arm64").url).toBe("https://example.test/mac-arm.dmg");
    expect(selectReleaseAsset(assets, "linux", "x64").url).toBe("https://example.test/linux.AppImage");
    expect(selectReleaseAsset(assets, "win32", "x64").url).toBe("https://example.test/win.exe");
  });
});
