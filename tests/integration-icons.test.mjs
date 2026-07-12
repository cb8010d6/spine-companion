import { describe, expect, it } from "vitest";

import { integrationBrand } from "../src/renderer/integration-icons.js";

describe("integration brand icons", () => {
  it("covers the supported AI integrations and common client aliases", () => {
    expect(integrationBrand("codex")?.key).toBe("openai");
    expect(integrationBrand("claude-desktop")?.key).toBe("anthropic");
    expect(integrationBrand("cursor")?.key).toBe("cursor");
    expect(integrationBrand("vs-code")?.key).toBe("vscode");
    expect(integrationBrand("gemini-cli")?.key).toBe("gemini");
    expect(integrationBrand("opencode")?.key).toBe("opencode");
    expect(integrationBrand("roo-code")?.key).toBe("roo");
    expect(integrationBrand("cline")?.key).toBe("cline");
    expect(integrationBrand("mimo-code")?.key).toBe("mimocode");
    expect(integrationBrand("custom")?.key).toBe("custom");
  });

  it("exposes locally bundled image metadata for supported upstream assets", () => {
    for (const id of ["codex", "claude-desktop", "cursor", "vs-code", "opencode", "roo-code", "cline", "mimo-code"]) {
      const brand = integrationBrand(id);
      expect(brand?.image).toMatch(/assets\/integrations\/.+\.svg$/);
      expect(brand?.localImage).toBe(brand?.image);
      expect(brand?.path).toBeTruthy();
    }

    expect(integrationBrand("gemini")?.image).toMatch(/assets\/integrations\/gemini\.png$/);
  });

  it("accepts custom colors and local image metadata without allowing remote images", () => {
    const custom = integrationBrand("custom", {
      color: "#f97316",
      localImage: "./assets/integrations/acme.svg"
    });
    expect(custom).toMatchObject({
      color: "#f97316",
      image: "./assets/integrations/acme.svg",
      localImage: "./assets/integrations/acme.svg"
    });

    expect(integrationBrand("custom", { image: "https://example.com/logo.svg" })?.image).toBeNull();
    expect(integrationBrand("custom", { image: "//example.com/logo.svg" })?.image).toBeNull();
  });

  it("leaves unknown tools on the generic fallback", () => {
    expect(integrationBrand("future-agent")).toBeNull();
  });
});
