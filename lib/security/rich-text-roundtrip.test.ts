import { describe, expect, test } from "bun:test";

import { sanitizeRichTextHtml as sanitizeOnClient } from "./html.client";
import { sanitizeRichTextHtml as sanitizeOnServer } from "./html.server";
import { richTextToPlainTextBlocks } from "./html";

/**
 * The canonical representation of a post body is sanitized HTML. It is produced
 * by the composer, written by the Server Action, read back for editing, and
 * rendered in the feed, so structure an author typed has to survive every hop
 * unchanged. These cases use the exact HTML ProseMirror serializes.
 */
function saveThenRender(editorHtml: string) {
  const composed = sanitizeOnClient(editorHtml);
  const stored = sanitizeOnServer(composed);
  const rendered = sanitizeOnClient(stored);
  const reopened = sanitizeOnClient(stored);
  return { composed, stored, rendered, reopened };
}

describe("canonical rich text round trip", () => {
  test("paragraphs typed with Enter survive save, render, and reopening", () => {
    const { composed, stored, rendered, reopened } = saveThenRender(
      "<p>First paragraph</p><p>Second paragraph</p>",
    );

    expect(composed).toBe("<p>First paragraph</p><p>Second paragraph</p>");
    expect(stored).toBe(composed);
    expect(rendered).toBe(composed);
    expect(reopened).toBe(composed);
  });

  test("a blank line between paragraphs is kept", () => {
    const { stored, rendered } = saveThenRender(
      "<p>Before</p><p></p><p>After</p>",
    );

    expect(stored).toBe("<p>Before</p><p></p><p>After</p>");
    expect(rendered).toBe(stored);
  });

  test("a Shift+Enter line break is kept inside its paragraph", () => {
    const { stored, rendered } = saveThenRender("<p>Line one<br>Line two</p>");

    expect(stored).toBe("<p>Line one<br />Line two</p>");
    expect(rendered).toBe(stored);
  });

  test("bulleted and numbered lists survive with their items intact", () => {
    const { stored, rendered } = saveThenRender(
      '<p>Bring:</p><ul class="list-disc list-outside ml-4"><li class="my-1"><p>Water</p></li><li class="my-1"><p>Sunscreen</p></li></ul><ol class="list-decimal list-outside ml-4"><li class="my-1"><p>Sign in</p></li><li class="my-1"><p>Collect a badge</p></li></ol>',
    );

    expect(stored).toBe(
      "<p>Bring:</p>" +
        "<ul><li><p>Water</p></li><li><p>Sunscreen</p></li></ul>" +
        "<ol><li><p>Sign in</p></li><li><p>Collect a badge</p></li></ol>",
    );
    expect(rendered).toBe(stored);
  });

  test("only trailing blank paragraphs are trimmed from the stored value", () => {
    const { stored } = saveThenRender(
      "<p>Body</p><ul><li><p>Item</p></li></ul><p></p><p></p>",
    );

    expect(stored).toBe("<p>Body</p><ul><li><p>Item</p></li></ul>");
  });

  test("the canonical form is stable, so re-saving an edited post is a no-op", () => {
    const editorHtml =
      '<p>Intro</p><p><br></p><ul class="list-disc"><li><p>Item</p></li></ul>';
    const once = sanitizeOnClient(editorHtml);

    expect(sanitizeOnClient(once)).toBe(once);
    expect(sanitizeOnServer(once)).toBe(once);
  });

  test("sanitization still removes unsafe markup from a pasted body", () => {
    const stored = sanitizeOnServer(
      sanitizeOnClient(
        '<p>Safe</p><script>alert(1)</script><p><a href="javascript:alert(1)">link</a></p>',
      ),
    );

    expect(stored).toContain("<p>Safe</p>");
    expect(stored).not.toMatch(/<script|javascript:/iu);
  });
});

describe("plain text projection of a canonical body", () => {
  test("paragraphs become separate blocks", () => {
    expect(
      richTextToPlainTextBlocks(
        "<p>First paragraph</p><p>Second paragraph</p>",
      ),
    ).toEqual(["First paragraph", "Second paragraph"]);
  });

  test("a line break stays a line break inside its block", () => {
    expect(richTextToPlainTextBlocks("<p>Line one<br />Line two</p>")).toEqual([
      "Line one\nLine two",
    ]);
  });

  test("a bulleted list stays one block and keeps a marker per item", () => {
    expect(
      richTextToPlainTextBlocks(
        "<p>Bring:</p><ul><li><p>Water</p></li><li><p>Sunscreen</p></li></ul>",
      ),
    ).toEqual(["Bring:", "• Water\n• Sunscreen"]);
  });

  test("a numbered list keeps its numbering", () => {
    expect(
      richTextToPlainTextBlocks(
        "<ol><li><p>Sign in</p></li><li><p>Collect a badge</p></li><li><p>Start</p></li></ol>",
      ),
    ).toEqual(["1. Sign in\n2. Collect a badge\n3. Start"]);
  });

  test("a nested list is indented under its parent item", () => {
    expect(
      richTextToPlainTextBlocks(
        "<ul><li><p>Shift A</p><ul><li><p>Morning</p></li></ul></li></ul>",
      ),
    ).toEqual(["• Shift A\n  • Morning"]);
  });

  test("entities and inline formatting are flattened, not escaped twice", () => {
    expect(
      richTextToPlainTextBlocks(
        "<p><strong>Snacks</strong> &amp; drinks &#39;provided&#39;</p>",
      ),
    ).toEqual(["Snacks & drinks 'provided'"]);
  });

  test("a plain text body written before rich text still splits on blank lines", () => {
    expect(
      richTextToPlainTextBlocks("First paragraph\n\nSecond paragraph"),
    ).toEqual(["First paragraph", "Second paragraph"]);
  });

  test("empty and blank bodies project to nothing", () => {
    expect(richTextToPlainTextBlocks("")).toEqual([]);
    expect(richTextToPlainTextBlocks(null)).toEqual([]);
    expect(richTextToPlainTextBlocks("<p></p><p><br /></p>")).toEqual([]);
  });

  test("the block count is bounded", () => {
    const body = Array.from(
      { length: 60 },
      (_, index) => `<p>Paragraph ${index}</p>`,
    ).join("");

    expect(richTextToPlainTextBlocks(body)).toHaveLength(40);
    expect(richTextToPlainTextBlocks(body, { maxBlocks: 3 })).toEqual([
      "Paragraph 0",
      "Paragraph 1",
      "Paragraph 2",
    ]);
  });
});
