import { describe, expect, it } from "vitest";
import {
  avatarActionKey,
  avatarResultToastKey,
  avatarStatusKey
} from "../src/renderer/avatar-ui.js";

describe("avatar studio presentation", () => {
  it("offers installation only for a runtime-ready pack", () => {
    expect(avatarActionKey({ ok: true, runtimeReady: true })).toBe("manager.avatar.installUse");
    expect(avatarStatusKey({ ok: true, runtimeReady: true })).toBe("manager.avatar.ready");
  });

  it("describes valid intermediate packs as drafts", () => {
    expect(avatarActionKey({ ok: true, runtimeReady: false })).toBe("manager.avatar.saveDraft");
    expect(avatarStatusKey({ ok: true, runtimeReady: false })).toBe("manager.avatar.draft");
  });

  it("distinguishes saved, installed, and activated results", () => {
    expect(avatarResultToastKey({ imported: true })).toBe("manager.avatar.savedDraft");
    expect(avatarResultToastKey({ installed: true })).toBe("manager.avatar.installed");
    expect(avatarResultToastKey({ activated: true })).toBe("manager.avatar.activated");
  });
});
