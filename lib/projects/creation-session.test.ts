import { describe, expect, test } from "bun:test";
import {
  projectAttemptStorage,
  projectCreationSessionId,
  projectCreationUrl,
} from "./creation-session";
import {
  clearStagedWaiverAttempt,
  createStagedWaiverAttempt,
  readStagedWaiverAttempt,
  writeStagedWaiverAttempt,
  type AttemptStorage,
} from "./staged-waiver-attempt";

const SESSION_A = "11111111-1111-4111-8111-111111111111";
const SESSION_B = "22222222-2222-4222-8222-222222222222";
const PROJECT = "33333333-3333-4333-8333-333333333333";
function memoryStorage(): AttemptStorage {
  const entries = new Map<string, string>();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    },
  };
}

describe("project creation identity", () => {
  test("a fresh New Project gets a new identity, while reload preserves its URL identity", () => {
    expect(projectCreationSessionId(SESSION_A)).toBe(SESSION_A);
    expect(projectCreationSessionId()).not.toBe(projectCreationSessionId());
    expect(projectCreationSessionId("../../foreign")).not.toBe("../../foreign");
    const url = projectCreationUrl(
      "https://example.test/projects/create?org=org-a#details",
      SESSION_A,
    );
    const reloaded = new URL(url, "https://example.test");
    expect(
      projectCreationSessionId(reloaded.searchParams.get("creation")!),
    ).toBe(SESSION_A);
    expect(reloaded.searchParams.get("org")).toBe("org-a");
    expect(reloaded.hash).toBe("#details");
  });

  test("first autosave and saved copies update the explicit resume URL without changing the editor", () => {
    const saved = projectCreationUrl(
      "https://example.test/projects/create?org=org-a",
      SESSION_A,
      "draft-a",
    );
    const copied = new URL(
      projectCreationUrl(`https://example.test${saved}`, SESSION_A, "draft-b"),
      "https://example.test",
    );
    expect(copied.searchParams.get("draft")).toBe("draft-b");
    expect(copied.searchParams.get("creation")).toBe(SESSION_A);
  });

  test("unfinished new creation survives reload but never transfers to a fresh editor", () => {
    const storage = memoryStorage();
    writeStagedWaiverAttempt(projectAttemptStorage(storage, SESSION_A), {
      ...createStagedWaiverAttempt(SESSION_A),
      projectId: PROJECT,
    });
    expect(
      readStagedWaiverAttempt(projectAttemptStorage(storage, SESSION_A))
        ?.projectId,
    ).toBe(PROJECT);
    expect(
      readStagedWaiverAttempt(projectAttemptStorage(storage, SESSION_B)),
    ).toBeNull();
  });

  test("explicitly resuming a draft retains only that draft's attempt across editor sessions", () => {
    const storage = memoryStorage();
    writeStagedWaiverAttempt(
      projectAttemptStorage(storage, SESSION_A, "draft-a"),
      {
        ...createStagedWaiverAttempt(SESSION_A),
        projectId: PROJECT,
      },
    );
    const resumed = projectAttemptStorage(storage, SESSION_B, "draft-a");
    expect(readStagedWaiverAttempt(resumed)?.projectId).toBe(PROJECT);
    expect(
      readStagedWaiverAttempt(
        projectAttemptStorage(storage, SESSION_A, "draft-b"),
      ),
    ).toBeNull();
    expect(
      readStagedWaiverAttempt(projectAttemptStorage(storage, SESSION_A)),
    ).toBeNull();
    clearStagedWaiverAttempt(resumed);
    expect(
      readStagedWaiverAttempt(
        projectAttemptStorage(storage, SESSION_A, "draft-a"),
      ),
    ).toBeNull();
  });

  test("old global attempts are never adopted without a known creation identity", () => {
    const storage = memoryStorage();
    writeStagedWaiverAttempt(storage, createStagedWaiverAttempt(SESSION_A));
    expect(
      readStagedWaiverAttempt(projectAttemptStorage(storage, SESSION_A)),
    ).toBeNull();
    expect(projectAttemptStorage(null, SESSION_A)).toBeNull();
  });
});
