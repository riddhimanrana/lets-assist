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
    expect(sync.receive(emittedAfterEnter, documentAfterEnter)).toBeNull();
  });

  test("the echo is still refused once the author clicks away", () => {
    const sync = createRichTextContentSync();
    sync.recordLocalEdit(emittedAfterEnter);
    expect(sync.receive(emittedAfterEnter, documentAfterEnter)).toBeNull();
  });

  test("a new external body is applied while the editor is idle", () => {
    const sync = createRichTextContentSync();
    sync.recordLocalEdit(emittedAfterEnter);
    expect(sync.receive("<p>Another post</p>", documentAfterEnter)).toBe(
      "<p>Another post</p>",
    );
  });

  test("the first external body is applied before anything is emitted", () => {
    const sync = createRichTextContentSync();
    expect(sync.receive("<p>Stored body</p>", "<p></p>")).toBe(
      "<p>Stored body</p>",
    );
  });

  test("a focused external change applies before the next edit", () => {
    const sync = createRichTextContentSync();
    sync.recordLocalEdit(emittedAfterEnter);
    expect(sync.receive("<p>Server edit</p>", documentAfterEnter)).toBe(
      "<p>Server edit</p>",
    );
    expect(sync.recordLocalEdit("<p>Server edit with new text</p>")).toBe(true);
    expect(
      sync.receive(
        "<p>Server edit with new text</p>",
        "<p>Server edit with new text</p>",
      ),
    ).toBeNull();
  });

  test("an older local echo cannot restore an earlier paragraph after newer typing", () => {
    const sync = createRichTextContentSync();
    const first = "<p>First</p>";
    const second = "<p>First and second</p>";
    sync.recordLocalEdit(first);
    sync.recordLocalEdit(second);
    expect(sync.receive(first, second)).toBeNull();
    expect(sync.receive(second, second)).toBeNull();
    expect(sync.recordLocalEdit("<p>First, second, and third</p>")).toBe(true);
  });

  test("an old local echo after an external switch cannot restore the old body", () => {
    const sync = createRichTextContentSync();
    sync.recordLocalEdit("<p>Old post draft</p>");
    expect(sync.receive("<p>New post</p>", "<p>Old post draft</p>")).toBe(
      "<p>New post</p>",
    );
    expect(sync.receive("<p>Old post draft</p>", "<p>New post</p>")).toBeNull();
    expect(sync.recordLocalEdit("<p>New post edited</p>")).toBe(true);
  });

  test("repeated external revisions apply immediately", () => {
    const sync = createRichTextContentSync();
    expect(sync.receive("<p>First change</p>", documentAfterEnter)).toBe(
      "<p>First change</p>",
    );
    expect(sync.receive("<p>Second change</p>", "<p>First change</p>")).toBe(
      "<p>Second change</p>",
    );
  });

  test("a delayed parent echo cannot replace a newer external change", () => {
    const sync = createRichTextContentSync();
    sync.recordLocalEdit(emittedAfterEnter);
    expect(sync.receive("<p>Server edit</p>", documentAfterEnter)).toBe(
      "<p>Server edit</p>",
    );
    expect(sync.receive(emittedAfterEnter, "<p>Server edit</p>")).toBeNull();
  });

  test("an identical body needs no replacement", () => {
    const sync = createRichTextContentSync();
    expect(sync.receive("<p>Same</p>", "<p>Same</p>")).toBeNull();
  });
});
