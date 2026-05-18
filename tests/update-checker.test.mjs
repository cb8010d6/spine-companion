import { describe, expect, it } from "vitest";

const { checkGitHubRelease, compareVersions } = require("../src/shared/update-checker.cjs");

describe("update-checker", () => {
  it("compares semver-like versions", () => {
    expect(compareVersions("0.2.1", "0.2.0")).toBe(1);
    expect(compareVersions("v0.2.0", "0.2.0")).toBe(0);
    expect(compareVersions("0.1.9", "0.2.0")).toBe(-1);
  });

  it("reports update availability from GitHub release response", async () => {
    const result = await checkGitHubRelease({
      currentVersion: "0.2.0",
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ tag_name: "v0.2.1", html_url: "https://example.test", name: "v0.2.1" })
      })
    });
    expect(result.updateAvailable).toBe(true);
    expect(result.latestVersion).toBe("0.2.1");
  });
});
