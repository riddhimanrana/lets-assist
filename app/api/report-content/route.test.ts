import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

describe("AUD-034 report-content boundary", () => {
  test("requires fresh auth, strict bounded input, and durable user/IP quota", () => {
    expect(source).toContain("getAuthUser({ sensitive: true })");
    expect(source).toContain("status: 503");
    expect(source).toContain("readBoundedContentReportBody");
    expect(source).toContain("normalizeReportedContentUrl");
    expect(source).toContain("consumeAiQuota");
    expect(source).toContain('scope: "user"');
    expect(source).toContain('scope: "ip"');
  });

  test("uses the admin client and owns initial moderation state", () => {
    expect(source).toContain("getAdminClient()");
    expect(source).not.toContain('from("@/lib/supabase/server")');
    expect(source).toContain('status: "pending"');
    expect(source).toContain("created_at: now");
    expect(source).toContain("updated_at: now");
  });

  test("keeps errors bounded and notification failure non-fatal", () => {
    expect(source).not.toContain("notifError,");
    expect(source).not.toContain(
      'logError("Unexpected error in report-content API", error',
    );
    expect(source).toContain("report_notification_failed");
    expect(source).toContain("success: true");
    expect(source).toContain("reportId: data.id");
    expect(source).toContain('message: "Report submitted successfully"');
  });

  test("exports only the supported POST route handler", () => {
    expect(source.match(/export\s+(?:async\s+)?function\s+/gu)).toEqual([
      "export async function ",
    ]);
  });
});
