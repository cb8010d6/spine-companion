import { describe, expect, it } from "vitest";
import { createI18n, detectLocale, dictionaries, setLocale, t } from "../src/shared/i18n.js";

describe("i18n", () => {
  it("keeps English and Chinese keys and placeholders aligned", () => {
    const englishKeys = Object.keys(dictionaries.en).sort();
    const chineseKeys = Object.keys(dictionaries["zh-CN"]).sort();
    expect(chineseKeys).toEqual(englishKeys);
    for (const key of englishKeys) {
      const placeholders = (value) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
      expect(placeholders(dictionaries["zh-CN"][key]), key).toEqual(placeholders(dictionaries.en[key]));
    }
  });

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

  it("covers diagnostics and quick panel labels in English", () => {
    setLocale("en");
    expect(t("manager.status.disabled")).toBe("Disabled");
    expect(t("manager.status.tauriExperimental")).toBe("Tauri experimental runtime");
    expect(t("panel.reminders.none")).toBe("No reminders");
    expect(t("panel.pin.pinned")).toBe("Pinned");
    expect(t("state.reviewing")).toBe("Reviewing");
  });
});
