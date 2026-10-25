import { expect, test } from "bun:test";
import { classifyWorkerResponse } from "./worker-outcome";

for (const worker of [
  "organization-calendar-sync",
  "organization-sheet-sync",
] as const) {
  const empty = {
    processed: 0,
    results: [],
    discoveryCounted: true,
    discoveryIncomplete: false,
    deferredOrganizations: 0,
  };

  test(`${worker}: a counted empty inventory is empty without invented work`, () => {
    expect(classifyWorkerResponse(worker, 200, empty)).toMatchObject({
      outcome: "no_run",
      code: "empty_queue",
      attempted: 0,
      pending: 0,
    });
  });

  test(`${worker}: all due organizations deferred are unfinished work`, () => {
    expect(
      classifyWorkerResponse(worker, 200, {
        ...empty,
        deferredOrganizations: 3,
      }),
    ).toMatchObject({ outcome: "partial", attempted: 0, pending: 3 });
  });

  test(`${worker}: completed work cannot conceal deferred due organizations`, () => {
    expect(
      classifyWorkerResponse(worker, 200, {
        ...empty,
        processed: 1,
        results: [{ success: true }],
        deferredOrganizations: 2,
      }),
    ).toMatchObject({ outcome: "partial", completed: 1, pending: 2 });
  });

  test(`${worker}: unknown discovery cannot become an empty completion`, () => {
    for (const flags of [
      { discoveryCounted: false, discoveryIncomplete: true },
      { discoveryCounted: false, discoveryIncomplete: false },
      { discoveryCounted: true, discoveryIncomplete: true },
    ]) {
      expect(
        classifyWorkerResponse(worker, 200, { ...empty, ...flags }),
      ).toMatchObject({ outcome: "partial", pending: 0 });
    }
  });

  test(`${worker}: malformed deferred counts and discovery flags are rejected`, () => {
    for (const deferredOrganizations of [-1, 0.5, "2", null, 1e20]) {
      expect(
        classifyWorkerResponse(worker, 200, {
          ...empty,
          deferredOrganizations,
        }).code,
      ).toBe("invalid_response");
    }
    for (const flags of [
      { discoveryCounted: "true" },
      { discoveryIncomplete: 0 },
    ]) {
      expect(
        classifyWorkerResponse(worker, 200, { ...empty, ...flags }).code,
      ).toBe("invalid_response");
    }
  });

  test(`${worker}: absent new fields preserve legacy response fixtures`, () => {
    expect(
      classifyWorkerResponse(worker, 200, { processed: 0, results: [] }),
    ).toMatchObject({ outcome: "no_run", code: "empty_queue" });
  });
}
