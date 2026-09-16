import { describe, expect, test } from "bun:test";

import {
  resolveRichTextKeyIntent,
  shouldApplyExternalRichTextContent,
} from "./rich-text-editor-behavior";

describe("rich text editor keys", () => {
  test("Enter starts a paragraph instead of reaching the form", () => {
    expect(resolveRichTextKeyIntent({ key: "Enter" })).toBe("new-paragraph");
  });

  test("Shift+Enter inserts a line break", () => {
    expect(resolveRichTextKeyIntent({ key: "Enter", shiftKey: true })).toBe(
      "line-break",
    );
  });

  test("Cmd or Ctrl plus Enter stays available to the host form", () => {
    expect(resolveRichTextKeyIntent({ key: "Enter", metaKey: true })).toBe(
      "pass-through",
    );
    expect(resolveRichTextKeyIntent({ key: "Enter", ctrlKey: true })).toBe(
      "pass-through",
    );
  });

  test("Cmd or Ctrl plus K opens the link dialog in either case", () => {
    expect(resolveRichTextKeyIntent({ key: "k", metaKey: true })).toBe(
      "open-link-dialog",
    );
    expect(resolveRichTextKeyIntent({ key: "K", ctrlKey: true })).toBe(
      "open-link-dialog",
    );
  });

  test("ordinary typing and plain k are not intercepted", () => {
    expect(resolveRichTextKeyIntent({ key: "a" })).toBe("pass-through");
    expect(resolveRichTextKeyIntent({ key: "k" })).toBe("pass-through");
    expect(resolveRichTextKeyIntent({ key: "Escape" })).toBe("pass-through");
  });
});

describe("rich text editor external content sync", () => {
  // The document after Enter at the end of a paragraph, and the canonical value
  // it emits. The canonical form trims the trailing empty paragraph, so feeding
  // it back would delete the paragraph the author just created.
  const documentAfterEnter = "<p>First paragraph</p><p></p>";
  const emittedAfterEnter = "<p>First paragraph</p>";

  test("a parent echoing the editor's own value never replaces the document", () => {
    expect(
      shouldApplyExternalRichTextContent({
        incoming: emittedAfterEnter,
        editorHtml: documentAfterEnter,
        lastSyncedValue: emittedAfterEnter,
        focused: true,
      }),
    ).toBe(false);
  });

  test("the echo is still refused once the author clicks away", () => {
    expect(
      shouldApplyExternalRichTextContent({
        incoming: emittedAfterEnter,
        editorHtml: documentAfterEnter,
        lastSyncedValue: emittedAfterEnter,
        focused: false,
      }),
    ).toBe(false);
  });

  test("a genuinely new body is applied while the editor is idle", () => {
    expect(
      shouldApplyExternalRichTextContent({
        incoming: "<p>Another post</p>",
        editorHtml: documentAfterEnter,
        lastSyncedValue: emittedAfterEnter,
        focused: false,
      }),
    ).toBe(true);
  });

  test("the first external body is applied before anything is emitted", () => {
    expect(
      shouldApplyExternalRichTextContent({
        incoming: "<p>Stored body</p>",
        editorHtml: "<p></p>",
        lastSyncedValue: null,
        focused: false,
      }),
    ).toBe(true);
  });

  test("a focused document is never reset under the caret", () => {
    expect(
      shouldApplyExternalRichTextContent({
        incoming: "<p>Another post</p>",
        editorHtml: documentAfterEnter,
        lastSyncedValue: emittedAfterEnter,
        focused: true,
      }),
    ).toBe(false);
  });

  test("an identical body is not reapplied", () => {
    expect(
      shouldApplyExternalRichTextContent({
        incoming: "<p>Same</p>",
        editorHtml: "<p>Same</p>",
        lastSyncedValue: null,
        focused: false,
      }),
    ).toBe(false);
  });
});
