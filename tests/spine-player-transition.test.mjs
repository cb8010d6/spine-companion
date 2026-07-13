import { describe, expect, it, vi } from "vitest";
import { attachTrackCompletion, modelCoreFitStates, modelViewportProfile, selectAvailableAnimation } from "../src/renderer/spine-player.js";

describe("Spine player transitions", () => {
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
