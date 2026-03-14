import { describe, expect, it } from "vitest";

import {
  escapeHtml,
  escapeHtmlWithLineBreaks,
  normalizeRichTextLinkUrl,
} from "@/lib/security/html";
import { sanitizeRichTextHtml } from "@/lib/security/html.server";

describe("HTML security helpers", () => {
  it("sanitizes rich text HTML by removing scripts and inline handlers", () => {
    const sanitized = sanitizeRichTextHtml(
      '<p>Hello<script>alert(1)</script><img src=x onerror="alert(2)"><a href="javascript:alert(3)">Click</a></p>'
    );

    expect(sanitized).toBe("<p>Hello<a>Click</a></p>");
  });

  it("preserves safe formatting and links in rich text HTML", () => {
    const sanitized = sanitizeRichTextHtml(
      '<p><strong>Hi</strong> <a href="https://example.com" target="_blank" rel="noopener noreferrer" class="link">there</a></p>'
    );

    expect(sanitized).toContain("<strong>Hi</strong>");
    expect(sanitized).toContain('href="https://example.com"');
    expect(sanitized).toContain('target="_blank"');
    expect(sanitized).toContain('rel="noopener noreferrer"');
  });

  it("normalizes supported rich-text links and rejects dangerous protocols", () => {
    expect(normalizeRichTextLinkUrl("example.com/form")).toBe("https://example.com/form");
    expect(normalizeRichTextLinkUrl("/projects/demo")).toBe("/projects/demo");
    expect(normalizeRichTextLinkUrl("mailto:test@example.com")).toBe("mailto:test@example.com");
    expect(normalizeRichTextLinkUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeRichTextLinkUrl("data:text/html,<svg>")).toBeNull();
  });

  it("escapes printable HTML content safely", () => {
    expect(escapeHtml('<img src=x onerror="boom">')).toBe(
      "&lt;img src=x onerror=&quot;boom&quot;&gt;"
    );
    expect(escapeHtmlWithLineBreaks("line 1\nline 2")).toBe("line 1<br />line 2");
  });
});