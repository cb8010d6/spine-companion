import { describe, expect, it } from "vitest";
import { createI18n, detectLocale, setLocale, t } from "../src/shared/i18n.js";

describe("i18n", () => {
  it("detects Chinese locale from navigator", () => {
    expect(detectLocale({}, { language: "zh-CN" })).toBe("zh-CN");
  });

  it("honors configured locale", () => {
    expect(detectLocale({ ui: { locale: "zh-CN" } }, { language: "en-US" })).toBe("zh-CN");
  });

  it("translates keys and falls back to English", () => {
    createI18n({ ui: { locale: "zh-CN" } }, { language: "en-US" });
    expect(t("manager.library.title")).toBe("模型库");
    setLocale("en");
    expect(t("manager.library.title")).toBe("Library");
  });
});
