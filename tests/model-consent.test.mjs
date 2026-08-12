import { describe, expect, it, vi } from "vitest";
import {
  acknowledgementDetails,
  createModelAcknowledgementCoordinator,
  createModelAcknowledgementSession,
  modelRequiresAcknowledgement,
  modelRevision
} from "../src/renderer/model-consent.js";

const arkModel = (id = "ark-amiya") => ({
  id,
  source: "Ark-Models",
  author: "isHarryh/Ark-Models contributors",
  license: "NOASSERTION",
  licenseWarning: "Upstream license and redistribution rights are not verified by this catalog.",
  repositoryUrl: `https://github.com/isHarryh/Ark-Models/tree/2f3187f780108847d7327946e1906fc6b80bead3/models/${id}`
});

describe("third-party model acknowledgement", () => {
  it("requires acknowledgement for NOASSERTION or an explicit warning", () => {
    expect(modelRequiresAcknowledgement(arkModel())).toBe(true);
    expect(modelRequiresAcknowledgement({ license: "MIT", licenseWarning: "Review upstream terms." })).toBe(true);
    expect(modelRequiresAcknowledgement({ license: "MIT", licenseWarning: "" })).toBe(false);
  });

  it("extracts immutable revisions and aggregates one source policy per action", () => {
    expect(modelRevision(arkModel())).toBe("2f3187f780108847d7327946e1906fc6b80bead3");
    const details = acknowledgementDetails([arkModel("one"), arkModel("two")]);
    expect(details).toHaveLength(1);
    expect(details[0]).toMatchObject({
      source: "Ark-Models",
      author: "isHarryh/Ark-Models contributors",
      license: "NOASSERTION",
      repository: "https://github.com/isHarryh/Ark-Models",
      revision: "2f3187f780108847d7327946e1906fc6b80bead3"
    });
  });

  it("remembers an accepted policy for the Manager session", () => {
    const session = createModelAcknowledgementSession();
    const models = [arkModel("one"), arkModel("two")];
    expect(session.pending(models)).toHaveLength(1);
    session.accept(models);
    expect(session.pending(models)).toEqual([]);
  });

  it("coalesces concurrent prompts for the same source policy", async () => {
    const coordinator = createModelAcknowledgementCoordinator();
    let release;
    const confirm = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    const first = coordinator.request([arkModel("one")], confirm);
    const second = coordinator.request([arkModel("two")], confirm);
    expect(confirm).toHaveBeenCalledTimes(1);

    release(true);
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("stops the action before network work when confirmation is cancelled", async () => {
    const coordinator = createModelAcknowledgementCoordinator();
    const network = vi.fn();
    const accepted = await coordinator.request([arkModel()], () => false);
    if (accepted) network();

    expect(accepted).toBe(false);
    expect(network).not.toHaveBeenCalled();
  });
});
