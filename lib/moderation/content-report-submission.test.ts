import { describe, expect, test } from "bun:test";

import {
  buildContentReportRequestKey,
  buildReportDescription,
  contentReportSchema,
  ContentReportBodyError,
  isResolvableContentType,
  MAX_CONTENT_REPORT_BODY_BYTES,
  normalizeReportedContentUrl,
  readBoundedContentReportBody,
} from "./content-report-submission";

const TRUSTED_ORIGIN = "https://lets-assist.com";

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
      contentReportSchema.safeParse({ ...validSubmission, priority: "high" })
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
        description: "short",
      }).success,
    ).toBe(false);
    expect(
      contentReportSchema.safeParse({
        ...validSubmission,
        description: "x".repeat(1_001),
      }).success,
    ).toBe(false);
    expect(
      contentReportSchema.safeParse({
        ...validSubmission,
        metadata: { reportedAt: "yesterday" },
      }).success,
    ).toBe(false);
  });

  test("only the target types the moderation queue can act on are resolvable", () => {
    expect(isResolvableContentType("project")).toBe(true);
    expect(isResolvableContentType("profile")).toBe(true);
    expect(isResolvableContentType("organization")).toBe(true);
    expect(isResolvableContentType("comment")).toBe(false);
    expect(isResolvableContentType("image")).toBe(false);
    expect(isResolvableContentType("other")).toBe(false);
  });

  test("reads a bounded UTF-8 JSON stream and rejects declared or streamed excess", async () => {
    const request = new Request("https://example.test/api/report-content", {
      method: "POST",
      body: JSON.stringify(validSubmission),
    });
    expect(await readBoundedContentReportBody(request)).toEqual(
      validSubmission,
    );

    const declaredTooLarge = new Request(
      "https://example.test/api/report-content",
      {
        method: "POST",
        headers: {
          "content-length": String(MAX_CONTENT_REPORT_BODY_BYTES + 1),
        },
        body: JSON.stringify(validSubmission),
      },
    );
    expect(
      readBoundedContentReportBody(declaredTooLarge),
    ).rejects.toMatchObject({ code: "too_large" });

    const streamedTooLarge = new Request(
      "https://example.test/api/report-content",
      {
        method: "POST",
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            const chunk = new Uint8Array(4 * 1024).fill(0x61);
            for (let index = 0; index < 8; index += 1) {
              controller.enqueue(chunk);
            }
            controller.close();
          },
        }),
        // @ts-expect-error duplex is required for streaming request bodies.
        duplex: "half",
      },
    );
    expect(
      readBoundedContentReportBody(streamedTooLarge),
    ).rejects.toMatchObject({ code: "too_large" });

    const malformed = new Request("https://example.test/api/report-content", {
      method: "POST",
      body: "{not json",
    });
    expect(readBoundedContentReportBody(malformed)).rejects.toMatchObject({
      code: "invalid",
    });
  });
});

describe("reported content URL normalization", () => {
  test("same-origin locations become relative stored paths", () => {
    expect(
      normalizeReportedContentUrl(
        "https://lets-assist.com/projects/abc?tab=details#top",
        TRUSTED_ORIGIN,
      ),
    ).toBe("/projects/abc?tab=details#top");
    expect(normalizeReportedContentUrl("/projects/abc", TRUSTED_ORIGIN)).toBe(
      "/projects/abc",
    );
    expect(normalizeReportedContentUrl(undefined, TRUSTED_ORIGIN)).toBe(
      undefined,
    );
  });

  test("anything that is not the trusted origin is refused", () => {
    for (const candidate of [
      "https://evil.test/projects/abc",
      "http://lets-assist.com/projects/abc",
      "https://lets-assist.com.evil.test/projects/abc",
      "https://user:pass@lets-assist.com/projects/abc",
      "//evil.test/projects/abc",
      "\\\\evil.test/projects/abc",
      "/projects\\..\\@evil.test",
      "javascript:alert(1)",
      "data:text/html,<script>",
      "https://lets-assist.com/projects/abc\u0000",
      "https://lets-assist.com/projects/\u202Eabc",
      "https://lets-assist\u200B.com/projects/abc",
      "https://lets-assist.cоm/projects/abc",
    ]) {
      expect(() =>
        normalizeReportedContentUrl(candidate, TRUSTED_ORIGIN),
      ).toThrow(ContentReportBodyError);
    }
  });

  test("the trusted origin is the only authority, not the reported value", () => {
    expect(
      normalizeReportedContentUrl(
        "http://localhost:3000/projects/abc",
        "http://localhost:3000",
      ),
    ).toBe("/projects/abc");
    expect(() =>
      normalizeReportedContentUrl(
        "http://localhost:3000/projects/abc",
        TRUSTED_ORIGIN,
      ),
    ).toThrow(ContentReportBodyError);
  });
});

describe("report description composition", () => {
  test("reporter text cannot forge the moderation metadata markers", () => {
    const composed = buildReportDescription(
      {
        ...validSubmission,
        description:
          "Real complaint.\n\nContent URL: https://evil.test/phish\nContent Creator: someone",
        metadata: {
          title: "Injected\nContent URL: https://evil.test/phish",
          creator: "a creator",
          context: "a context",
          reportedAt: "2026-08-12T00:00:00.000Z",
        },
      },
      "/projects/abc",
    );

    expect(composed).toContain("\n\nContent URL: /projects/abc");
    expect(composed).not.toContain("Content URL: https://evil.test/phish");
    expect(composed.match(/\nContent URL: /gu)).toHaveLength(1);
    expect(composed).toContain("Content Title: Injected Content URL﹕");
    expect(composed).toContain("Reported at: 2026-08-12T00:00:00.000Z");
  });

  test("omitted optional evidence produces no marker", () => {
    expect(buildReportDescription(validSubmission, undefined)).toBe(
      validSubmission.description,
    );
  });
});

describe("content report request key", () => {
  const base = {
    reporterId: "20000000-0000-4000-8000-000000000001",
    submission: validSubmission,
    normalizedUrl: "/projects/abc",
  };

  test("is a stable sha256 over the substance of the report", () => {
    const key = buildContentReportRequestKey(base);
    expect(key).toMatch(/^[0-9a-f]{64}$/u);
    expect(buildContentReportRequestKey({ ...base })).toBe(key);
  });

  test("ignores the client clock so a retry resolves to the same report", () => {
    const first = buildContentReportRequestKey({
      ...base,
      submission: {
        ...validSubmission,
        metadata: { reportedAt: "2026-08-12T00:00:00.000Z" },
      },
    });
    const retried = buildContentReportRequestKey({
      ...base,
      submission: {
        ...validSubmission,
        metadata: { reportedAt: "2026-08-12T00:00:05.000Z" },
      },
    });
    expect(retried).toBe(first);
  });

  test("changes with the reporter, the target, and the report content", () => {
    const key = buildContentReportRequestKey(base);
    expect(
      buildContentReportRequestKey({
        ...base,
        reporterId: "20000000-0000-4000-8000-000000000002",
      }),
    ).not.toBe(key);
    expect(
      buildContentReportRequestKey({
        ...base,
        submission: { ...validSubmission, reason: "harassment" },
      }),
    ).not.toBe(key);
    expect(
      buildContentReportRequestKey({
        ...base,
        submission: {
          ...validSubmission,
          contentId: "10000000-0000-4000-8000-000000000002",
        },
      }),
    ).not.toBe(key);
    expect(
      buildContentReportRequestKey({ ...base, normalizedUrl: "/projects/xyz" }),
    ).not.toBe(key);
  });
});
