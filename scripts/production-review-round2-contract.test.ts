import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const paperActions = readFileSync(
  join(root, "app/projects/[id]/paper-signups/actions.ts"),
  "utf8",
);
const feedbackActions = readFileSync(
  join(root, "app/projects/[id]/server/feedback.ts"),
  "utf8",
);
const migration = readFileSync(
  join(
    root,
    "supabase/migrations/20260818074500_atomic_paper_scan_discard.sql",
  ),
  "utf8",
);

describe("Production review round-two contracts", () => {
  test("paper discard is one locked RPC with a transactional deletion outbox", () => {
    const discardAction = paperActions.slice(
      paperActions.indexOf("export async function discardPaperScanBatch"),
    );
    expect(discardAction).toContain('.rpc("discard_paper_scan_batch"');
    expect(discardAction).not.toContain(
      '.from("paper_scan_storage_deletion_queue")',
    );
    expect(migration).toContain("FOR UPDATE;");
    expect(migration).toContain(
      "INSERT INTO public.paper_scan_storage_deletion_queue",
    );
    expect(migration).toContain("SET purged_at = now()");
    expect(
      migration.indexOf("INSERT INTO public.paper_scan_storage_deletion_queue"),
    ).toBeLessThan(migration.indexOf("SET purged_at = now()"));
    expect(migration).toContain("IF v_batch.status = 'committed' THEN");
    expect(migration).toContain("SET status = 'discarded'");
  });

  test("service-role token edits reset moderation before the AI call", () => {
    const tokenAction = feedbackActions.slice(
      feedbackActions.indexOf(
        "export async function submitProjectFeedbackWithToken",
      ),
    );
    const updateIndex = tokenAction.indexOf(
      'comment_moderation_status: comment ? "pending" : "not_applicable"',
    );
    const moderationIndex = tokenAction.indexOf(
      "await moderateFeedbackComment(",
    );
    expect(updateIndex).toBeGreaterThan(0);
    expect(tokenAction).toContain("comment_flag_reason: null");
    expect(moderationIndex).toBeGreaterThan(updateIndex);
  });
});
