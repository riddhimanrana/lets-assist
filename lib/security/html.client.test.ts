import { describe, expect, it } from "bun:test";

import { sanitizeRichTextHtml } from "./html.client";

describe("client rich-text sanitization", () => {
  it("removes executable elements, handlers, styles, and unsafe links", () => {
    const sanitized = sanitizeRichTextHtml(`
      <p onclick="alert(1)" style="background:url(javascript:alert(1))">
        Safe text
        <script>alert(1)</script>
        <img src=x onerror="alert(1)">
        <a href="javascript:alert(1)" target="_blank">unsafe link</a>
      </p>
    `);

    expect(sanitized).toContain("Safe text");
    expect(sanitized).not.toMatch(
      /<script|<img|onclick|onerror|style=|javascript:/iu,
    );
  });

  it("keeps the reviewed formatting and link protocols", () => {
    const sanitized = sanitizeRichTextHtml(
      '<p><strong>Important</strong> <a href="https://example.com/path">details</a></p>',
    );

    expect(sanitized).toBe(
      '<p><strong>Important</strong> <a href="https://example.com/path">details</a></p>',
    );
  });
});
