import { describe, expect, it } from "vitest";
import { resolveThemePreference } from "../src/renderer/theme.js";

describe("theme preference", () => {
  it("follows the system preference", () => {
    expect(resolveThemePreference("system", true)).toBe("dark");
    expect(resolveThemePreference("system", false)).toBe("light");
  });

  it("keeps explicit themes independent of the system", () => {
    expect(resolveThemePreference("light", true)).toBe("light");
    expect(resolveThemePreference("dark", false)).toBe("dark");
  });

  it("treats unknown values as system", () => {
    expect(resolveThemePreference("unknown", true)).toBe("dark");
  });
});
