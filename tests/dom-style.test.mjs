// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";

import { h } from "../src/renderer/lib/dom.js";

describe("DOM style helper", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("writes CSS custom properties into the style declaration", () => {
    const node = h("span", { style: { "--integration-brand": "#10a37f", color: "white" } });
    expect(node.style.getPropertyValue("--integration-brand")).toBe("#10a37f");
    expect(node.style.color).toBe("white");
  });
});
