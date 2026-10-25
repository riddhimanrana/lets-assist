import { describe, expect, test } from "bun:test";
import {
  runPublicImageCleanup,
  type PublicImageCleanupDependencies,
} from "./public-image-cleanup";
const id = "11111111-1111-4111-8111-111111111111";
const token = "22222222-2222-4222-8222-222222222222";
const path = `${id}-123.webp`;
function fixture(rows: unknown[]) {
  const calls: unknown[] = [];
  let time = 0;
  const dependencies: PublicImageCleanupDependencies = {
    now: () => time,
    claim: async () => rows.shift() ?? [],
    remove: async (bucket, object) => {
      calls.push(["remove", bucket, object]);
      return true;
    },
    finish: async (object, claim, removed) => {
      calls.push(["finish", object, claim, removed]);
      return removed;
    },
  };
  return {
    calls,
    dependencies,
    tick: (value: number) => {
      time += value;
    },
  };
}
const claim = () => [
  {
    id,
    claim_token: token,
    bucket_id: "avatars",
    object_name: path,
    retained: false,
  },
];
describe("public image cleanup worker", () => {
  test("uses the claimed exact object then waits for independent acknowledgement", async () => {
    const state = fixture([claim()]);
    expect(await runPublicImageCleanup(state.dependencies)).toEqual({
      claimed: 1,
      deleted: 1,
      retained: 0,
      retryable: 0,
      failed: 0,
    });
    expect(state.calls).toEqual([
      ["remove", "avatars", path],
      ["finish", id, token, true],
    ]);
  });
  test("current references are retained without provider access", async () => {
    const state = fixture([[{ id, retained: true }]]);
    expect(await runPublicImageCleanup(state.dependencies)).toMatchObject({
      claimed: 1,
      retained: 1,
      deleted: 0,
    });
    expect(state.calls).toEqual([]);
  });
  test("an uncertain delete requests retry under its same claim", async () => {
    const state = fixture([claim()]);
    state.dependencies.remove = async () => {
      throw new Error("provider-private-marker");
    };
    expect(await runPublicImageCleanup(state.dependencies)).toMatchObject({
      retryable: 1,
      deleted: 0,
    });
    expect(state.calls).toEqual([["finish", id, token, false]]);
  });
  test("remaining metadata or stale lease cannot count as deleted", async () => {
    const state = fixture([claim()]);
    state.dependencies.finish = async () => false;
    expect(await runPublicImageCleanup(state.dependencies)).toMatchObject({
      retryable: 1,
      deleted: 0,
    });
  });
  test("failed acknowledgement counts one unsettled confirmed claim", async () => {
    const state = fixture([claim()]);
    state.dependencies.finish = async () => {
      throw new Error("database-private-marker");
    };
    expect(await runPublicImageCleanup(state.dependencies)).toEqual({
      claimed: 1,
      deleted: 0,
      retained: 0,
      retryable: 0,
      failed: 1,
    });
  });
  test("invalid or foreign paths are rejected before any deletion", async () => {
    for (const changed of [
      { bucket_id: "waiver-signatures" },
      { object_name: `${id}/../other.webp` },
      { object_name: "foreign.png" },
      { claim_token: "invalid" },
    ]) {
      const state = fixture([[{ ...claim()[0], ...changed }]]);
      await expect(runPublicImageCleanup(state.dependencies)).rejects.toThrow(
        "claim could not be confirmed",
      );
      expect(state.calls).toEqual([]);
    }
  });
  test("bounds work by ten claims and by the remaining request deadline", async () => {
    const full = fixture(Array.from({ length: 20 }, claim));
    expect((await runPublicImageCleanup(full.dependencies)).claimed).toBe(10);
    const timed = fixture([claim(), claim(), claim()]);
    timed.dependencies.remove = async () => {
      timed.tick(14_000);
      return true;
    };
    expect((await runPublicImageCleanup(timed.dependencies)).claimed).toBe(1);
  });
  test("empty queue returns no object identifiers or provider errors", async () => {
    const state = fixture([]);
    expect(await runPublicImageCleanup(state.dependencies)).toEqual({
      claimed: 0,
      deleted: 0,
      retained: 0,
      retryable: 0,
      failed: 0,
    });
  });
});
