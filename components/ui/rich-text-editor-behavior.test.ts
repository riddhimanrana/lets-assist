import { describe, expect, test } from "bun:test";

import {
  createRichTextContentSync,
  resolveRichTextKeyIntent,
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
    const sync = createRichTextContentSync();
    expect(sync.recordLocalEdit(emittedAfterEnter)).toBe(true);
    expect(
      sync.receive(emittedAfterEnter, documentAfterEnter, true),
    ).toBeNull();
    expect(sync.flushOnBlur(documentAfterEnter)).toBeNull();
  });

  test("the echo is still refused once the author clicks away", () => {
    const sync = createRichTextContentSync();
    sync.recordLocalEdit(emittedAfterEnter);
    expect(
      sync.receive(emittedAfterEnter, documentAfterEnter, false),
    ).toBeNull();
  });

  test("a genuinely new body is applied while the editor is idle", () => {
    const sync = createRichTextContentSync();
    sync.recordLocalEdit(emittedAfterEnter);
    expect(sync.receive("<p>Another post</p>", documentAfterEnter, false)).toBe(
      "<p>Another post</p>",
    );
  });

  test("the first external body is applied before anything is emitted", () => {
    const sync = createRichTextContentSync();
    expect(sync.receive("<p>Stored body</p>", "<p></p>", false)).toBe(
      "<p>Stored body</p>",
    );
  });

  test("a focused external change wins on blur and blocks stale edits", () => {
    const sync = createRichTextContentSync();
    sync.recordLocalEdit(emittedAfterEnter);
    expect(
      sync.receive("<p>Server edit</p>", documentAfterEnter, true),
    ).toBeNull();
    expect(sync.recordLocalEdit("<p>Stale local edit</p>")).toBe(false);
    expect(sync.flushOnBlur("<p>Stale local edit</p>")).toBe(
      "<p>Server edit</p>",
    );
    expect(
      sync.receive("<p>Server edit</p>", "<p>Server edit</p>", false),
    ).toBeNull();
    expect(sync.recordLocalEdit("<p>New edit</p>")).toBe(true);
  });

  test("a second external change replaces the deferred value", () => {
    const sync = createRichTextContentSync();
    sync.receive("<p>First change</p>", documentAfterEnter, true);
    sync.receive("<p>Second change</p>", documentAfterEnter, true);
    expect(sync.flushOnBlur(documentAfterEnter)).toBe("<p>Second change</p>");
  });

  test("a delayed parent echo cannot cancel a newer external change", () => {
    const sync = createRichTextContentSync();
    sync.recordLocalEdit(emittedAfterEnter);
    sync.receive("<p>Server edit</p>", documentAfterEnter, true);
    sync.receive(emittedAfterEnter, documentAfterEnter, true);
    expect(sync.flushOnBlur(documentAfterEnter)).toBe("<p>Server edit</p>");
  });

  test("an identical body clears a pending replacement", () => {
    const sync = createRichTextContentSync();
    sync.receive("<p>Server edit</p>", "<p>Same</p>", true);
    expect(sync.receive("<p>Same</p>", "<p>Same</p>", true)).toBeNull();
    expect(sync.flushOnBlur("<p>Same</p>")).toBeNull();
  });
});
