import { describe, expect, test } from "bun:test";

import { buildReportDescription } from "./content-report-submission";
import {
  parseReportDescription,
  resolveSafeReportPath,
} from "./report-description";

/**
 * The composer and the parser are two halves of one format, and a reporter
 * controls the input to the first. These tests are written as round trips
 * wherever possible: compose something hostile, parse it back, and assert the
 * moderator sees the reporter's words as words rather than as server-attested
 * metadata.
 */

const baseSubmission = {
  contentType: "project" as const,
  contentId: "10000000-0000-4000-8000-000000000001",
  reason: "spam" as const,
  description: "This project contains repeated promotional content.",
};

function roundTrip(
  submission: Partial<typeof baseSubmission> & {
    description?: string;
    metadata?: Record<string, string>;
  },
  normalizedUrl?: string,
) {
  return parseReportDescription(
    buildReportDescription(
      { ...baseSubmission, ...submission } as Parameters<
        typeof buildReportDescription
      >[0],
      normalizedUrl,
    ),
  );
}

describe("metadata marker forgery", () => {
  test("a marker spelled across a newline cannot survive composition", () => {
    const parsed = roundTrip(
      {
        metadata: { title: "Injected\nContent URL: https://evil.test/phish" },
      },
      "/projects/abc",
    );

    expect(parsed.metadata.contentUrl).toBe("/projects/abc");
    // The reporter's words survive verbatim apart from the marker delimiter,
    // which is what a moderator should see: a claim, not an attested location.
    expect(parsed.metadata.contentTitle).toBe(
      "Injected Content URL\uFE55 https://evil.test/phish",
    );
  });

  test("every whitespace, case, and separator variant of a marker is neutralized", () => {
    const variants = [
      "Content\nURL: https://evil.test",
      "Content\tURL: https://evil.test",
      "Content   URL: https://evil.test",
      "content url: https://evil.test",
      "CONTENT URL : https://evil.test",
      "Content\r\nURL:https://evil.test",
      "Content URL\u00a0: https://evil.test",
    ];

    for (const variant of variants) {
      const parsed = roundTrip(
        { metadata: { title: variant } },
        "/projects/abc",
      );
      expect(parsed.metadata.contentUrl).toBe("/projects/abc");
      expect(parsed.metadata.contentTitle).toContain("\uFE55");
    }
  });

  test("control and bidi characters are removed rather than stored", () => {
    const parsed = roundTrip({
      description:
        "Real complaint\u202ewith reversed text\u0000and a null\u200bplus a zero width.",
      metadata: { context: "Injected\u202eContext: forged" },
    });

    const disguising = ["\u0000", "\u200b", "\u202e"];
    for (const character of disguising) {
      expect(parsed.notes).not.toContain(character);
      expect(parsed.metadata.context).not.toContain(character);
    }
  });

  test("a marker in the reporter's own prose stays prose", () => {
    const parsed = roundTrip({
      description:
        "They kept posting this.\nContent URL: https://evil.test/phish\nPlease review.",
    });

    expect(parsed.metadata.contentUrl).toBeUndefined();
    expect(parsed.notes).toContain("Please review.");
  });

  test("only one authentic location marker is ever composed", () => {
    const composed = buildReportDescription(
      {
        ...baseSubmission,
        description: "Content URL: https://evil.test/one",
        metadata: {
          title: "Content URL: https://evil.test/two",
          creator: "Content URL: https://evil.test/three",
          context: "Content URL: https://evil.test/four",
        },
      },
      "/projects/abc",
    );

    expect(composed.match(/^Content URL: /gmu)).toHaveLength(1);
    expect(parseReportDescription(composed).metadata.contentUrl).toBe(
      "/projects/abc",
    );
  });
});

describe("parsing a composed description", () => {
  test("server metadata is read back exactly as composed", () => {
    const parsed = roundTrip(
      {
        description: "Please review this listing.",
        metadata: {
          title: "A Project Title",
          creator: "A Creator",
          context: "Some context",
          reportedAt: "2026-08-12T00:00:00.000Z",
        },
      },
      "/projects/abc?tab=details",
    );

    expect(parsed).toEqual({
      notes: "Please review this listing.",
      metadata: {
        contentUrl: "/projects/abc?tab=details",
        contentTitle: "A Project Title",
        contentCreator: "A Creator",
        context: "Some context",
        reportedAt: "2026-08-12T00:00:00.000Z",
      },
    });
  });

  test("a description with no metadata is all notes", () => {
    expect(parseReportDescription("Just the reporter's words.")).toEqual({
      notes: "Just the reporter's words.",
      metadata: {},
    });
    expect(parseReportDescription(undefined)).toEqual({
      notes: "",
      metadata: {},
    });
    expect(parseReportDescription("   ")).toEqual({ notes: "", metadata: {} });
  });

  test("a label that does not start its line is not a field", () => {
    const parsed = parseReportDescription(
      "See Content URL: /evil for details.\n\nContent URL: /projects/abc",
    );

    expect(parsed.metadata.contentUrl).toBe("/projects/abc");
    expect(parsed.notes).toContain("See Content URL: /evil for details.");
  });

  test("the first occurrence of a field wins", () => {
    const parsed = parseReportDescription(
      "Notes.\n\nContent URL: /projects/first\nContent URL: /projects/second",
    );

    expect(parsed.metadata.contentUrl).toBe("/projects/first");
  });
});

describe("linkable report locations", () => {
  test("an application-relative path is preserved", () => {
    expect(resolveSafeReportPath("/projects/abc")).toBe("/projects/abc");
    expect(resolveSafeReportPath("/projects/abc?tab=1#top")).toBe(
      "/projects/abc?tab=1#top",
    );
  });

  test("nothing a reporter could aim off-origin is linkable", () => {
    for (const candidate of [
      undefined,
      null,
      "",
      "   ",
      "https://evil.test/phish",
      "http://lets-assist.com/projects/abc",
      "//evil.test/phish",
      "\\\\evil.test\\phish",
      "/projects\\..\\@evil.test",
      "javascript:alert(1)",
      "data:text/html,<script>",
      "projects/abc",
      "/projects/abc\u0000",
      "/projects/\u202eabc",
      "/projects/ abc",
      `/${"a".repeat(2_100)}`,
    ]) {
      expect(resolveSafeReportPath(candidate)).toBeUndefined();
    }
  });

  test("a legacy absolute location is dropped rather than linked", () => {
    const parsed = parseReportDescription(
      "Old evidence.\n\nContent URL: https://lets-assist.com/projects/abc",
    );

    expect(parsed.metadata.contentUrl).toBe(
      "https://lets-assist.com/projects/abc",
    );
    expect(resolveSafeReportPath(parsed.metadata.contentUrl)).toBeUndefined();
  });
});
