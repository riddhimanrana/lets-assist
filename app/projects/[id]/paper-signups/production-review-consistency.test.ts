import { describe, expect, test } from "bun:test";

const read = (relative: string) =>
  Bun.file(new URL(relative, import.meta.url)).text();

describe("production review consistency boundaries", () => {
  test("feedback moderation settles only the exact pending comment", async () => {
    const source = await read("../server/feedback.ts");

    expect(source).toContain('.eq("comment", comment)');
    expect(source).toContain('.eq("comment_moderation_status", "pending")');
    expect(source).toContain('if (settled && status !== "allowed")');
    expect(source).toContain('row.comment_moderation_status === "allowed"');
    expect(source).toContain('row.comment_moderation_status === "flagged"');
    expect(source).toContain("isSuperAdminUser(user)");
  });

  test("review edits use the parent-locking service RPC", async () => {
    const source = await read("./actions.ts");

    expect(source).toContain('"update_paper_scan_review_row"');
    expect(source).toContain("p_actor_id: userId");
    expect(source).toContain('if (outcome === "not_review")');
    expect(source).not.toContain(
      '.from("project_paper_scan_rows")\n    .update({',
    );
  });

  test("claim-owned final transitions prove a matched update", async () => {
    const source = await read("../../../api/ai/scan-signup-sheet/route.ts");

    expect(source).toContain("if (failError || !failedBatch)");
    expect(source).toContain("if (reviewError || !reviewBatch)");
    expect(source).toContain(
      "const { data: failedBatch, error: failError } = await admin",
    );
    expect(source).toContain(
      "const { data: reviewBatch, error: reviewError } = await admin",
    );
    expect(source).toContain("const { error: clearRowsError } = await admin");
    expect(source).toContain("if (clearRowsError)");
  });

  test("supplemental certificate failures remain visible and retryable", async () => {
    const actions = await read("./actions.ts");
    const client = await read("./PaperSignupsClient.tsx");
    const migration = await read(
      "../../../../supabase/migrations/20260818170000_serialize_paper_attendance_publication.sql",
    );

    expect(actions).toContain("certificateStatusError");
    expect(actions).toContain('.from("certificates")');
    expect(actions).not.toContain("certificateErrors = issuance.errors");
    expect(migration).toContain(
      "issue_verified_certificate_for_late_attendance",
    );
    expect(migration).toContain(
      "public.issue_supplemental_verified_certificates",
    );
    expect(actions).toContain(
      "export async function retryPaperScanCertificates",
    );
    expect(client).toContain("Attendance saved; certificates need attention");
    expect(client).toContain("Retry certificate issuance");
  });

  test("paper attendance and publication are serialized in the database", async () => {
    const migration = await read(
      "../../../../supabase/migrations/20260818170000_serialize_paper_attendance_publication.sql",
    );

    expect(migration).toContain("FOR UPDATE");
    expect(migration).toContain("NEW.status = 'committing'");
    expect(migration).toContain("publication snapshot is stale");
    expect(migration).toContain("certificates.id IS NULL");
    expect(migration).toContain("v_entry_count > 1000");
    expect(migration).toContain("hours-publication:certificate:");
    expect(migration).toContain("hours_publication_email_outbox");
    expect(migration).toContain("publication_origin = 'automatic'");
    expect(migration).toContain("app.paper_commit_actor_id");
    expect(migration).toContain(
      "COALESCE(v_commit_actor_id, v_project.creator_id)",
    );
  });

  test("candidate read failures abort extraction instead of matching an empty roster", async () => {
    const source = await read("../../../api/ai/scan-signup-sheet/route.ts");

    expect(source).toContain("signupCandidatesError");
    expect(source).toContain("anonCandidatesError");
    expect(source).toContain("Failed to load scan match candidates");
  });

  test("paper signup notification outbox has a hosted scheduler", async () => {
    const workflow = await read(
      "../../../../.github/workflows/paper-signup-notifications.yml",
    );
    const feedbackWorkflow = await read(
      "../../../../.github/workflows/project-feedback-followups.yml",
    );

    expect(workflow).toContain('cron: "3,13,23,33,43,53 * * * *"');
    expect(workflow).toContain(
      "ENDPOINT_PATH: /api/cron/paper-signup-notifications",
    );
    expect(workflow).toContain("environment: production");
    expect(workflow).toContain(
      "CRON_TOKEN: ${{ secrets.PAPER_SIGNUP_NOTIFICATION_WORKER_SECRET_TOKEN || secrets.CRON_SECRET }}",
    );
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("jq -r '.enabled // false'");
    expect(workflow).toContain(
      "Paper signup notification worker is not enabled",
    );
    expect(feedbackWorkflow).toContain("jq -r '.enabled // false'");
    expect(feedbackWorkflow).toContain(
      "Project feedback worker is not enabled",
    );
  });
});
