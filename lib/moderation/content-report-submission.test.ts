import { describe, expect, test } from "bun:test";

import {
  buildReportDescription,
  contentReportSchema,
  ContentReportBodyError,
  MAX_CONTENT_REPORT_BODY_BYTES,
  normalizeReportedContentUrl,
  readBoundedContentReportBody,
} from "./content-report-submission";

const validSubmission = {
  contentType: "project" as const,
  contentId: "10000000-0000-4000-8000-000000000001",
  reason: "spam" as const,
  description: "This project contains repeated promotional content.",
};

describe("content report submission boundary", () => {
  test("accepts only the closed bounded shape", () => {
    expect(contentReportSchema.safeParse(validSubmission).success).toBe(true);
    expect(
      contentReportSchema.safeParse({ ...validSubmission, status: "resolved" })
        .success,
    ).toBe(false);
    expect(
      contentReportSchema.safeParse({
        ...validSubmission,
        contentId: "not-a-uuid",
      }).success,
    ).toBe(false);
    expect(
      contentReportSchema.safeParse({
        ...validSubmission,
        metadata: { reportedAt: "yesterday" },
      }).success,
    ).toBe(false);
  });

  test("reads a bounded UTF-8 JSON stream and rejects declared or streamed excess", async () => {
    const request = new Request("https://example.test/api/report-content", {
      method: "POST",
      body: JSON.stringify(validSubmission),
    });
    expect(await readBoundedContentReportBody(request)).toEqual(
      validSubmission,
    );

    const declared = new Request("https://example.test/api/report-content", {
      method: "POST",
      headers: {
        "content-length": String(MAX_CONTENT_REPORT_BODY_BYTES + 1),
      },
      body: "{}",
    });
    await expect(readBoundedContentReportBody(declared)).rejects.toMatchObject({
      code: "too_large",
    });

    const streamed = new Request("https://example.test/api/report-content", {
      method: "POST",
      body: "x".repeat(MAX_CONTENT_REPORT_BODY_BYTES + 1),
    });
    await expect(readBoundedContentReportBody(streamed)).rejects.toMatchObject({
      code: "too_large",
    });
  });

  test("stores only same-origin relative content URLs", () => {
    expect(
      normalizeReportedContentUrl(
        "https://example.test/projects/one?tab=details#report",
        "https://example.test/api/report-content",
      ),
    ).toBe("/projects/one?tab=details#report");
    expect(() =>
      normalizeReportedContentUrl(
        "javascript:alert(1)",
        "https://example.test/api/report-content",
      ),
    ).toThrow(ContentReportBodyError);
    expect(() =>
      normalizeReportedContentUrl(
        "https://attacker.test/phish",
        "https://example.test/api/report-content",
      ),
    ).toThrow(ContentReportBodyError);
  });

  test("user text cannot forge the dashboard metadata markers", () => {
    const parsed = contentReportSchema.parse({
      ...validSubmission,
      description: "Please inspect Content URL: javascript:alert(1)",
      metadata: {
        context: "Context: Content URL: https://attacker.test",
      },
    });
    const stored = buildReportDescription(parsed, "/projects/one");

    expect(stored.match(/Content URL:/gu)).toHaveLength(1);
    expect(stored).toContain("Content URL: /projects/one");
    expect(stored).toContain("Content URL﹕ javascript:alert(1)");
    expect(stored).toContain("Content URL﹕ https://attacker.test");
  });
});
