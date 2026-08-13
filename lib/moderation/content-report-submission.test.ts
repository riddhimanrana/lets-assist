import { describe, expect, test } from "bun:test";

import {
  buildContentReportFingerprint,
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

  test("the advertised target types are exactly the ones that resolve", () => {
    for (const contentType of ["project", "profile", "organization"]) {
      expect(
        contentReportSchema.safeParse({ ...validSubmission, contentType })
          .success,
      ).toBe(true);
    }

    // These were accepted by the schema and then refused a step later, because
    // no relation and no moderator action stands behind them.
    for (const contentType of ["comment", "image", "other"]) {
      expect(
        contentReportSchema.safeParse({ ...validSubmission, contentType })
          .success,
      ).toBe(false);
    }
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

  test("a location this deployment cannot vouch for is dropped, not fatal", () => {
    // Preview, branch, and custom aliases are all legitimately not the
    // configured origin. The browser sends whichever one it is on, and the
    // report itself is still valid: the target type and identifier are what
    // moderators act on.
    for (const alias of [
      "https://lets-assist-git-feature.vercel.app/projects/abc",
      "https://lets-assist-abc123.vercel.app/projects/abc",
      "https://staging.lets-assist.com/projects/abc",
      "http://lets-assist.com/projects/abc",
      "https://lets-assist.com.evil.test/projects/abc",
      "https://evil.test/projects/abc",
      "https://lets-assist.cоm/projects/abc",
    ]) {
      expect(
        normalizeReportedContentUrl(alias, TRUSTED_ORIGIN),
      ).toBeUndefined();
    }
  });

  test("an unsafe spelling is refused outright", () => {
    // Nothing here has a benign reading, so these stay hard failures rather
    // than being silently dropped.
    for (const candidate of [
      "https://user:pass@lets-assist.com/projects/abc",
      "//evil.test/projects/abc",
      "\\\\evil.test/projects/abc",
      "/projects\\..\\@evil.test",
      "javascript:alert(1)",
      "data:text/html,<script>",
      "https://lets-assist.com/projects/abc\u0000",
      "https://lets-assist.com/projects/\u202Eabc",
      "https://lets-assist\u200B.com/projects/abc",
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
    expect(
      normalizeReportedContentUrl(
        "http://localhost:3000/projects/abc",
        TRUSTED_ORIGIN,
      ),
    ).toBeUndefined();
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

describe("content report request fingerprint", () => {
  const base = {
    reporterId: "20000000-0000-4000-8000-000000000001",
    submission: validSubmission,
    normalizedUrl: "/projects/abc",
  };

  test("two submissions of the same substance fingerprint identically", () => {
    // Built independently rather than by reusing one object, so this asserts
    // canonicalization rather than that a pure function is pure.
    const first = buildContentReportFingerprint({
      reporterId: "20000000-0000-4000-8000-000000000001",
      submission: {
        contentType: "project",
        contentId: "10000000-0000-4000-8000-000000000001",
        reason: "spam",
        description: "This project contains repeated promotional content.",
      },
      normalizedUrl: "/projects/abc",
    });
    const retried = buildContentReportFingerprint({
      reporterId: "20000000-0000-4000-8000-000000000001",
      submission: {
        reason: "spam",
        contentId: "10000000-0000-4000-8000-000000000001",
        description: "This project contains repeated promotional content.",
        contentType: "project",
      },
      normalizedUrl: "/projects/abc",
    });

    expect(first).toMatch(/^[0-9a-f]{64}$/u);
    expect(retried).toBe(first);
  });

  test("carries no time component, so a retry resolves to the same report", () => {
    const first = buildContentReportFingerprint({
      ...base,
      submission: {
        ...validSubmission,
        metadata: { reportedAt: "2026-08-12T00:00:00.000Z" },
      },
    });
    const retried = buildContentReportFingerprint({
      ...base,
      submission: {
        ...validSubmission,
        metadata: { reportedAt: "2026-08-12T00:00:05.000Z" },
      },
    });

    expect(retried).toBe(first);
  });

  test("each part of the report's substance changes the fingerprint", () => {
    const vectors: Array<
      [string, Parameters<typeof buildContentReportFingerprint>[0]]
    > = [
      [
        "a different reporter",
        { ...base, reporterId: "20000000-0000-4000-8000-000000000002" },
      ],
      [
        "a different reason",
        { ...base, submission: { ...validSubmission, reason: "harassment" } },
      ],
      [
        "a different target",
        {
          ...base,
          submission: {
            ...validSubmission,
            contentId: "10000000-0000-4000-8000-000000000002",
          },
        },
      ],
      [
        "a different target type",
        {
          ...base,
          submission: { ...validSubmission, contentType: "organization" },
        },
      ],
      [
        "different reporter prose",
        {
          ...base,
          submission: {
            ...validSubmission,
            description: "A materially different complaint about this project.",
          },
        },
      ],
      ["a different location", { ...base, normalizedUrl: "/projects/xyz" }],
      ["no location at all", { ...base, normalizedUrl: undefined }],
      [
        "different supporting metadata",
        {
          ...base,
          submission: { ...validSubmission, metadata: { title: "Something" } },
        },
      ],
    ];

    const baseline = buildContentReportFingerprint(base);
    const seen = new Set([baseline]);

    for (const [label, input] of vectors) {
      const fingerprint = buildContentReportFingerprint(input);
      expect(
        fingerprint,
        `${label} must not collide with the baseline`,
      ).not.toBe(baseline);
      expect(seen.has(fingerprint), `${label} must be distinct`).toBe(false);
      seen.add(fingerprint);
    }
  });
});
