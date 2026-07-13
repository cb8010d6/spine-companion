import { describe, expect, it } from "vitest";
import { selectEvenSample, summarizeAudit, verifyCatalogBytes } from "../scripts/audit-model-catalog.mjs";

describe("catalog audit sampling", () => {
  it("selects a deterministic one-percent sample across the full catalog", () => {
    const models = Array.from({ length: 908 }, (_, index) => ({ id: index }));
    const sample = selectEvenSample(models, 0.01);
    expect(sample).toHaveLength(9);
    expect(sample[0].id).toBeGreaterThan(0);
    expect(sample.at(-1).id).toBeLessThan(907);
    expect(selectEvenSample(models, 0.01)).toEqual(sample);
  });

  it("summarizes versions and the models with the fewest animations", () => {
    const records = [
      { kind: "operators", id: "many", detectedVersion: "3.8.99", animationCount: 7, animations: ["Idle"] },
      { kind: "operators", id: "few", detectedVersion: "3.8.84", animationCount: 3, animations: ["Idle"] }
    ];
    const summary = summarizeAudit(records, [], { operators: 908 });
    expect(summary.operators.versions).toEqual({ "3.8.99": 1, "3.8.84": 1 });
    expect(summary.operators.animationCount).toEqual({ min: 3, median: 7, max: 7 });
    expect(summary.operators.fewest[0].id).toBe("few");
  });

  it("verifies sampled bytes against the immutable Git blob digest", () => {
    const bytes = new TextEncoder().encode("hello\n");
    expect(() => verifyCatalogBytes({
      sizeBytes: 6,
      githubBlobSha: "ce013625030ba8dba906f756967f9e9ca394464a"
    }, bytes)).not.toThrow();
    expect(() => verifyCatalogBytes({
      sizeBytes: 6,
      githubBlobSha: "0000000000000000000000000000000000000000"
    }, bytes)).toThrow(/Git blob SHA/);
  });
});
