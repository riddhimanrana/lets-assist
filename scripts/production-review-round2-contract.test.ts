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
const signupActions = readFileSync(join(root, "app/signup/actions.ts"), "utf8");
const feedbackUnsubscribeRoute = readFileSync(
  join(root, "app/feedback/[requestId]/unsubscribe/route.ts"),
  "utf8",
);
const paperCleanupWorker = readFileSync(
  join(root, "lib/projects/paper-signup/cleanup-storage.ts"),
  "utf8",
);
const migration = readFileSync(
  join(
    root,
    "supabase/migrations/20260818074500_atomic_paper_scan_discard.sql",
  ),
  "utf8",
);
const raceGuardMigration = readFileSync(
  join(
    root,
    "supabase/migrations/20260819002500_serialize_plugin_deletion_and_token_feedback.sql",
  ),
  "utf8",
);
const paperCleanupMigration = readFileSync(
  join(
    root,
    "supabase/migrations/20260819020000_serialize_paper_scan_orphan_cleanup.sql",
  ),
  "utf8",
);
const anonymousFeedbackPreferenceMigration = readFileSync(
  join(
    root,
    "supabase/migrations/20260819030000_propagate_anonymous_feedback_opt_out.sql",
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

  test("service-role token edits use the atomic eligibility RPC before the AI call", () => {
    const tokenAction = feedbackActions.slice(
      feedbackActions.indexOf(
        "export async function submitProjectFeedbackWithToken",
      ),
    );
    const updateIndex = tokenAction.indexOf(
      '"submit_project_feedback_from_request"',
    );
    const moderationIndex = tokenAction.indexOf(
      "await moderateFeedbackComment(",
    );
    expect(updateIndex).toBeGreaterThan(0);
    expect(raceGuardMigration).toContain("FOR UPDATE");
    expect(raceGuardMigration).toContain("signups.status = 'attended'");
    expect(raceGuardMigration).toContain("projects.status = 'completed'");
    expect(
      raceGuardMigration.indexOf("FROM public.projects AS projects"),
    ).toBeLessThan(
      raceGuardMigration.indexOf("FROM public.project_signups AS signups"),
    );
    expect(
      raceGuardMigration.match(
        /hashtextextended\('plugin-control-plane-entitlements', 0\)/g,
      ),
    ).toHaveLength(2);
    expect(raceGuardMigration).toContain(
      "locks.organization_id = v_old_organization_id",
    );
    expect(raceGuardMigration).toContain(
      "locks.organization_id = v_new_organization_id",
    );
    expect(raceGuardMigration).toContain("comment_flag_reason = NULL");
    expect(moderationIndex).toBeGreaterThan(updateIndex);
  });

  test("orphan cleanup holds a durable lease across reference recheck and Storage deletion", () => {
    expect(paperActions).toContain('"queue_orphaned_paper_scan_uploads"');
    expect(paperCleanupWorker).toContain(
      '"acquire_paper_scan_storage_cleanup_lock"',
    );
    expect(paperCleanupWorker).toContain('.from("project_paper_scan_images")');
    expect(paperCleanupWorker).toContain('.is("purged_at", null)');
    expect(paperCleanupWorker).toContain(
      '"release_paper_scan_storage_cleanup_lock"',
    );
    expect(paperCleanupMigration).toContain(
      "hashtextextended('paper-scan-storage-cleanup', 0)",
    );
    expect(paperCleanupMigration).toContain(
      "paper scan storage cleanup is in progress",
    );
    expect(paperCleanupMigration).toContain(
      "DELETE FROM public.paper_scan_storage_deletion_queue",
    );
  });

  test("canonical signup context and anonymous address preferences survive later identities", () => {
    const googleSignup = signupActions.slice(
      signupActions.indexOf("export async function signInWithGoogle"),
    );
    expect(googleSignup).toContain("buildCanonicalSignupPath({");
    expect(googleSignup).toContain("redirectPath: redirectAfterAuth");
    expect(googleSignup).toContain("staffToken: inviteContext?.staffToken");
    expect(feedbackUnsubscribeRoute).toContain(
      'admin.rpc("set_anonymous_feedback_email_opt_out"',
    );
    expect(anonymousFeedbackPreferenceMigration).toContain(
      "CREATE TABLE private.anonymous_feedback_email_preferences",
    );
    expect(anonymousFeedbackPreferenceMigration).toContain(
      "CREATE TRIGGER apply_anonymous_feedback_email_preference",
    );
    expect(anonymousFeedbackPreferenceMigration).toContain(
      "anonymous-feedback-email-preference:",
    );
    expect(anonymousFeedbackPreferenceMigration).toContain(
      "WHERE signup.email_opt_out_at IS NOT NULL",
    );
    expect(anonymousFeedbackPreferenceMigration).toContain(
      "FROM PUBLIC, anon, authenticated, service_role",
    );
  });
});
