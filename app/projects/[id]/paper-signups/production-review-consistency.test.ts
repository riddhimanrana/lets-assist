import { describe, expect, test } from "bun:test";

const read = (relative: string) =>
  Bun.file(new URL(relative, import.meta.url)).text();

describe("production review consistency boundaries", () => {
  test("feedback moderation settles only the exact pending comment", async () => {
    const source = await read("../server/feedback.ts");

    expect(source).toContain('.eq("comment", comment)');
    expect(source).toContain('.eq("comment_moderation_status", "pending")');
    expect(source).toContain('if (settled && status !== "allowed")');
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
  });

  test("supplemental certificate failures remain visible and retryable", async () => {
    const actions = await read("./actions.ts");
    const client = await read("./PaperSignupsClient.tsx");

    expect(actions).toContain("certificateErrors = issuance.errors");
    expect(actions).toContain(
      "export async function retryPaperScanCertificates",
    );
    expect(client).toContain("Attendance saved; certificates need attention");
    expect(client).toContain("Retry certificate issuance");
  });
});
