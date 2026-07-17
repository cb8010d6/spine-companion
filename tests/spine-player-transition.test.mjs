import { describe, expect, it, vi } from "vitest";
import {
  ReplacementRevision,
  activeRecoveryHistory,
  attachTrackCompletion,
  animationRecoveryAction,
  modelCoreFitStates,
  modelViewportProfile,
  normalizeFrameRateMode,
  selectAvailableAnimation,
  tickerMaxFps,
  trackEntryNeedsReplay
} from "../src/renderer/spine-player.js";

describe("Spine player transitions", () => {
  it("keeps display refresh as the default and exposes explicit power modes", () => {
    expect(normalizeFrameRateMode("unknown")).toBe("display");
    expect(tickerMaxFps("display", false, "smooth")).toBe(0);
    expect(tickerMaxFps("60", false, "smooth")).toBe(60);
    expect(tickerMaxFps("30", false, "smooth")).toBe(30);
    expect(tickerMaxFps("display", true, "compatible")).toBe(42);
    expect(tickerMaxFps("30", true, "compatible")).toBe(30);
  });

  it("replays missing, completed, or stale looping tracks", () => {
    expect(trackEntryNeedsReplay(null, 0, 10_000)).toBe(true);
    expect(trackEntryNeedsReplay({ loop: false, isComplete: () => true }, 9_000, 10_000)).toBe(true);
    expect(trackEntryNeedsReplay({ loop: true, timeScale: 1 }, 5_000, 9_000)).toBe(true);
    expect(trackEntryNeedsReplay({ loop: true, timeScale: 1 }, 8_000, 9_000)).toBe(false);
    expect(trackEntryNeedsReplay({ loop: true, timeScale: 0 }, 5_000, 9_000)).toBe(false);
  });

  it("escalates a stalled loop without skipping cooldown or rate limits", () => {
    expect(animationRecoveryAction({ stale: true })).toBe("replay");
    expect(animationRecoveryAction({ stale: true, previousRecoveryAgeMs: 10_000 })).toBe("none");
    expect(animationRecoveryAction({ stale: true, recentRecoveries: 3 })).toBe("rate-limited");
    expect(animationRecoveryAction({ step: 1, elapsedMs: 1_999 })).toBe("none");
    expect(animationRecoveryAction({ step: 1, elapsedMs: 2_000 })).toBe("rebuild");
    expect(animationRecoveryAction({ step: 2, elapsedMs: 2_000 })).toBe("recreate");
    expect(animationRecoveryAction({ step: 2, elapsedMs: 5_000, progressed: true })).toBe("none");
  });

  it("expires recovery rate limits after the five-minute window", () => {
    expect(activeRecoveryHistory([1_000, 50_000, 299_999], 301_001)).toEqual([50_000, 299_999]);
    expect(activeRecoveryHistory([1_000, 2_000, 3_000], 400_000)).toEqual([]);
  });

  it("rejects stale model replacements that finish after a newer request", () => {
    const revisions = new ReplacementRevision();
    const first = revisions.begin();
    const second = revisions.begin();
    expect(revisions.isCurrent(first)).toBe(false);
    expect(revisions.isCurrent(second)).toBe(true);
    revisions.invalidate();
    expect(revisions.isCurrent(second)).toBe(false);
  });

  it("uses only stable everyday states to normalize model layout", () => {
    expect(modelCoreFitStates({})).toEqual(["idle", "working", "running", "waiting"]);
    expect(modelCoreFitStates({ coreFitStates: ["idle", "working"] })).toEqual(["idle", "working"]);
  });

  it("gives dynamic illustrations a larger but bounded viewport profile", () => {
    expect(modelViewportProfile({ modelCategory: "operator", maxViewportFill: 0.72 })).toMatchObject({
      viewportFill: 0.72,
      scaleBoost: 1
    });
    expect(modelViewportProfile({ modelCategory: "illustration", framePadding: 1.08, maxViewportFill: 0.72 })).toMatchObject({
      framePadding: 1.02,
      viewportFill: 0.88,
      scaleBoost: 1.15
    });
  });

  it("returns from a one-shot only when its active track entry completes", () => {
    const entry = {};
    const complete = vi.fn();
    let current = true;
    attachTrackCompletion(entry, complete, () => current);
    entry.listener.complete();
    expect(complete).toHaveBeenCalledTimes(1);
    current = false;
    entry.listener.complete();
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("falls back to a safe animation when a model lacks companion actions", () => {
    expect(selectAvailableAnimation(["Default", "Idle"], "Interact")).toBe("Idle");
    expect(selectAvailableAnimation(["Attack", "Move"], "Relax")).toBe("");
    expect(selectAvailableAnimation(["Relax"], "Relax")).toBe("Relax");
    expect(selectAvailableAnimation(["A_Attack", "A_Default", "A_Idle"], "Relax")).toBe("A_Idle");
    expect(selectAvailableAnimation(["Move_Loop", "Idle"], "move")).toBe("Move_Loop");
    expect(selectAvailableAnimation(["idle"], "Relax")).toBe("idle");
  });
});
