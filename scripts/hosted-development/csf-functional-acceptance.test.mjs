import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hostedAcceptanceMode,
  passesHostedFunctionalAcceptance,
} from "./csf-functional-acceptance.mjs";

test("functional acceptance keeps distinct roles, persisted mutations and clean browser journeys", () => {
  const result = {
    distinctAuthIdentities: 2,
    distinctAuthSessions: 2,
    reviewNavigationCount: 25,
    mutationCount: 30,
    browserErrors: 0,
  };
  assert.equal(passesHostedFunctionalAcceptance(result), true);
  for (const [field, value] of Object.entries({
    distinctAuthIdentities: 1,
    distinctAuthSessions: 1,
    reviewNavigationCount: 24,
    mutationCount: 0,
    browserErrors: 1,
  }))
    assert.equal(
      passesHostedFunctionalAcceptance({ ...result, [field]: value }),
      false,
      field,
    );
  assert.equal(
    passesHostedFunctionalAcceptance({ ...result, readP95Ms: 90000 }),
    true,
  );
});

test("full acceptance stays the default and malformed modes fail", () => {
  assert.equal(hostedAcceptanceMode(), "full");
  assert.equal(hostedAcceptanceMode("functional"), "functional");
  for (const mode of ["", "skip", "FULL", null])
    assert.throws(() => hostedAcceptanceMode(mode));
});
