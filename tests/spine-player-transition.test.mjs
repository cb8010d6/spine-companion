import { describe, expect, it, vi } from "vitest";
import { attachTrackCompletion, modelCoreFitStates } from "../src/renderer/spine-player.js";

describe("Spine player transitions", () => {
  it("uses only stable everyday states to normalize model layout", () => {
    expect(modelCoreFitStates({})).toEqual(["idle", "working", "running", "waiting"]);
    expect(modelCoreFitStates({ coreFitStates: ["idle", "working"] })).toEqual(["idle", "working"]);
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
});
