import { describe, expect, test } from "bun:test";

import { evaluateCiGate } from "./check-ci-gate.mjs";

describe("CI aggregate gate", () => {
  test("accepts full and documentation-only validation", () => {
    expect(
      evaluateCiGate({
        changesResult: "success",
        fullValidation: "true",
        qualityResult: "success",
        databaseResult: "success",
      }),
    ).toBeNull();
    expect(
      evaluateCiGate({
        changesResult: "success",
        fullValidation: "false",
        qualityResult: "success",
        databaseResult: "skipped",
      }),
    ).toBeNull();
  });

  test("fails closed when classification fails or has no output", () => {
    expect(
      evaluateCiGate({
        changesResult: "failure",
        fullValidation: "",
        qualityResult: "success",
        databaseResult: "skipped",
      }),
    ).toContain("Change classification finished");
    expect(
      evaluateCiGate({
        changesResult: "success",
        fullValidation: "",
        qualityResult: "success",
        databaseResult: "skipped",
      }),
    ).toContain("invalid value");
  });

  test("requires the database job only for full validation", () => {
    expect(
      evaluateCiGate({
        changesResult: "success",
        fullValidation: "true",
        qualityResult: "success",
        databaseResult: "skipped",
      }),
    ).toContain("Database and browser");
    expect(
      evaluateCiGate({
        changesResult: "success",
        fullValidation: "false",
        qualityResult: "success",
        databaseResult: "success",
      }),
    ).toContain("expected the database job to be skipped");
  });
});
