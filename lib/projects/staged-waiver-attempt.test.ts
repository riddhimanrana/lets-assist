import { describe, expect, test } from "bun:test";

import {
  clearStagedWaiverAttempt,
  createStagedWaiverAttempt,
  readStagedWaiverAttempt,
  resumeOrStartStagedWaiverAttempt,
  writeStagedWaiverAttempt,
  type AttemptStorage,
} from "./staged-waiver-attempt";

const KEY_ONE = "11111111-1111-4111-8111-111111111111";
const KEY_TWO = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";

function memoryStorage(seed: Record<string, string> = {}): AttemptStorage & {
  entries: Record<string, string>;
} {
  const entries: Record<string, string> = { ...seed };

  return {
    entries,
    getItem: (key) => entries[key] ?? null,
    setItem: (key, value) => {
      entries[key] = value;
    },
    removeItem: (key) => {
      delete entries[key];
    },
  };
}

describe("staged waiver attempt", () => {
  test("a reload before publication resumes the same attempt", () => {
    const storage = memoryStorage();

    const first = createStagedWaiverAttempt(KEY_ONE);
    writeStagedWaiverAttempt(storage, { ...first, projectId: PROJECT_ID });

    // A reload throws away every in-memory ref; only storage survives.
    const afterReload = resumeOrStartStagedWaiverAttempt(storage, KEY_TWO);

    expect(afterReload.idempotencyKey).toBe(KEY_ONE);
    expect(afterReload.projectId).toBe(PROJECT_ID);
  });

  test("a fresh session starts a new attempt with the supplied key", () => {
    const storage = memoryStorage();

    expect(resumeOrStartStagedWaiverAttempt(storage, KEY_TWO)).toEqual({
      idempotencyKey: KEY_TWO,
      projectId: null,
      uploadedFiles: false,
      waiverAttached: false,
    });
  });

  test("a published attempt is cleared, so the next create is a new project", () => {
    const storage = memoryStorage();
    writeStagedWaiverAttempt(storage, {
      idempotencyKey: KEY_ONE,
      projectId: PROJECT_ID,
      uploadedFiles: true,
      waiverAttached: true,
    });

    clearStagedWaiverAttempt(storage);

    expect(readStagedWaiverAttempt(storage)).toBeNull();
    expect(
      resumeOrStartStagedWaiverAttempt(storage, KEY_TWO).idempotencyKey,
    ).toBe(KEY_TWO);
  });

  test("side effects that already succeeded are remembered across a retry", () => {
    const storage = memoryStorage();
    const attempt = createStagedWaiverAttempt(KEY_ONE);

    writeStagedWaiverAttempt(storage, {
      ...attempt,
      projectId: PROJECT_ID,
      uploadedFiles: true,
      waiverAttached: true,
    });

    const resumed = readStagedWaiverAttempt(storage);

    expect(resumed?.uploadedFiles).toBe(true);
    expect(resumed?.waiverAttached).toBe(true);
  });

  test("a malformed or foreign entry is discarded rather than trusted", () => {
    for (const raw of [
      "not json",
      "null",
      '{"idempotencyKey":"not-a-uuid","projectId":"' + PROJECT_ID + '"}',
      '{"projectId":"' + PROJECT_ID + '"}',
      "[]",
    ]) {
      const storage = memoryStorage({
        "lets-assist:staged-project-attempt:v1": raw,
      });

      expect(readStagedWaiverAttempt(storage)).toBeNull();
    }
  });

  test("a stored project id that is not a uuid is dropped, not replayed", () => {
    const storage = memoryStorage({
      "lets-assist:staged-project-attempt:v1": JSON.stringify({
        idempotencyKey: KEY_ONE,
        projectId: "../../some/other/thing",
        uploadedFiles: "yes",
        waiverAttached: 1,
      }),
    });

    expect(readStagedWaiverAttempt(storage)).toEqual({
      idempotencyKey: KEY_ONE,
      projectId: null,
      uploadedFiles: false,
      waiverAttached: false,
    });
  });

  test("an unavailable storage never throws and never resumes", () => {
    const throwing: AttemptStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };

    expect(readStagedWaiverAttempt(throwing)).toBeNull();
    expect(() =>
      writeStagedWaiverAttempt(throwing, createStagedWaiverAttempt(KEY_ONE)),
    ).not.toThrow();
    expect(() => clearStagedWaiverAttempt(throwing)).not.toThrow();
    expect(readStagedWaiverAttempt(null)).toBeNull();
  });
});
