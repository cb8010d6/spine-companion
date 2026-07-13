import { describe, expect, it } from "vitest";

const { checkGitHubRelease, compareVersions, selectReleaseAsset } = require("../src/shared/update-checker.cjs");

describe("update-checker", () => {
  it("compares semver-like versions", () => {
    expect(compareVersions("0.2.1", "0.2.0")).toBe(1);
    expect(compareVersions("v0.2.0", "0.2.0")).toBe(0);
    expect(compareVersions("0.1.9", "0.2.0")).toBe(-1);
    expect(compareVersions("0.2.3-alpha.2", "0.2.3-alpha.1")).toBe(1);
    expect(compareVersions("0.2.6-rc.7.1", "0.2.6-rc.7")).toBe(1);
    expect(compareVersions("0.2.3-alpha.1", "0.2.2")).toBe(1);
    expect(compareVersions("0.2.3", "0.2.3-alpha.2")).toBe(1);
  });

  it("reports update availability from GitHub release response", async () => {
    let requestedUrl = "";
    const result = await checkGitHubRelease({
      currentVersion: "0.2.0",
      platform: "win32",
      arch: "x64",
      fetchImpl: async (url) => {
        requestedUrl = url;
        return {
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
        };
      }
    });
    expect(requestedUrl).toContain("/releases/latest");
    expect(result.updateAvailable).toBe(true);
    expect(result.latestVersion).toBe("0.2.1");
    expect(result.recommendedAsset.name).toContain("setup.exe");
    expect(result.downloadUrl).toBe("https://example.test/setup.exe");
    expect(result.channel).toBe("stable");
    expect(result.source).toContain("/releases/latest");
  });

  it("checks prerelease channel when the current version is a prerelease", async () => {
    let requestedUrl = "";
    const result = await checkGitHubRelease({
      currentVersion: "0.2.3-alpha.1",
      platform: "win32",
      arch: "x64",
      fetchImpl: async (url) => {
        requestedUrl = url;
        return {
          ok: true,
          json: async () => ([
            {
              tag_name: "v0.2.2",
              html_url: "https://example.test/stable",
              name: "v0.2.2",
              prerelease: false,
              draft: false,
              assets: [
                { name: "Spine.Companion_0.2.2_x64-setup.exe", browser_download_url: "https://example.test/stable.exe" }
              ]
            },
            {
              tag_name: "v0.2.3-alpha.2",
              html_url: "https://example.test/alpha2",
              name: "v0.2.3-alpha.2",
              prerelease: true,
              draft: false,
              assets: [
                { name: "Spine.Companion_0.2.3-alpha.2_x64-setup.exe", browser_download_url: "https://example.test/alpha2.exe" }
              ]
            }
          ])
        };
      }
    });
    expect(requestedUrl).toContain("/releases?per_page=20");
    expect(result.updateAvailable).toBe(true);
    expect(result.latestVersion).toBe("0.2.3-alpha.2");
    expect(result.downloadUrl).toBe("https://example.test/alpha2.exe");
    expect(result.channel).toBe("prerelease");
    expect(result.source).toContain("/releases?per_page=20");
  });

  it("honors a user-selected stable channel on a prerelease build", async () => {
    let requestedUrl = "";
    const result = await checkGitHubRelease({
      currentVersion: "0.2.6-rc.1",
      channel: "stable",
      fetchImpl: async (url) => {
        requestedUrl = url;
        return {
          ok: true,
          json: async () => ({
            tag_name: "v0.2.5",
            html_url: "https://example.test/stable",
            prerelease: false,
            assets: []
          })
        };
      }
    });
    expect(requestedUrl).toContain("/releases/latest");
    expect(result.channel).toBe("stable");
    expect(result.configuredChannel).toBe("stable");
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
