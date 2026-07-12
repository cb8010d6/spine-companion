import { describe, expect, it } from "vitest";

import { integrationBrand } from "../src/renderer/integration-icons.js";

describe("integration brand icons", () => {
  it("maps the primary AI tools to recognizable local vector icons", () => {
    expect(integrationBrand("codex")?.key).toBe("openai");
    expect(integrationBrand("claude-desktop")?.key).toBe("anthropic");
    expect(integrationBrand("vscode")?.key).toBe("vscode");
    expect(integrationBrand("cursor")?.key).toBe("cursor");
  });

  it("leaves unknown tools on the generic fallback", () => {
    expect(integrationBrand("future-agent")).toBeNull();
  });
});
