import { describe, expect, test } from "bun:test";
import { nextPaperCommitAttempt } from "./commit-attempt";

const row = (id: string, reviewRevision = 0) => ({
  id,
  reviewRevision,
  decision: "include",
});
const input = {
  projectId: "project-a",
  batchId: "batch-a",
  allowOverCapacity: false,
  rows: [row("one"), row("two")],
};

describe("paper commit recovery", () => {
  test("lost partial response followed by refresh and correction starts a new operation", () => {
    const initial = nextPaperCommitAttempt(null, input, () => "original-key");
    // The server committed row one, failed row two, and its response was lost.
    // Repeating unchanged reviewed input must retrieve the original receipt.
    const retry = nextPaperCommitAttempt(initial, input, () => {
      throw new Error("An uncertain unchanged request must retain its key");
    });
    expect(retry.key).toBe("original-key");
    expect(retry.rowIds).toEqual(["one", "two"]);

    // An authoritative refresh removes the saved row; coordinator review then
    // fixes the remaining row. Its new commit must not reuse the old receipt.
    const remaining = nextPaperCommitAttempt(
      retry,
      { ...input, rows: [row("two", 1)] },
      () => "remaining-key",
    );
    expect(remaining.key).toBe("remaining-key");
    expect(remaining.rowIds).toEqual(["two"]);
    expect(
      nextPaperCommitAttempt(remaining, { ...input, rows: [row("two", 1)] })
        .key,
    ).toBe("remaining-key");
  });

  test("corrected failed rows get a new key even when all row IDs stay the same", () => {
    const initial = nextPaperCommitAttempt(null, input, () => "lost-key");
    const corrected = nextPaperCommitAttempt(
      initial,
      { ...input, rows: [row("one", 1), row("two")] },
      () => "corrected-key",
    );
    expect(corrected.rowIds).toEqual(initial.rowIds);
    expect(corrected.key).toBe("corrected-key");
  });

  test("row ordering does not create a new operation, but scope, decisions and capacity do", () => {
    const initial = nextPaperCommitAttempt(null, input, () => "stable-key");
    expect(
      nextPaperCommitAttempt(initial, {
        ...input,
        rows: [...input.rows].reverse(),
      }).key,
    ).toBe("stable-key");
    for (const changed of [
      { ...input, projectId: "other-project" },
      { ...input, batchId: "other-batch" },
      { ...input, allowOverCapacity: true },
      { ...input, rows: [{ ...row("one"), decision: "exclude" }, row("two")] },
    ]) {
      expect(
        nextPaperCommitAttempt(initial, changed, () => "changed-key").key,
      ).toBe("changed-key");
    }
  });
});
