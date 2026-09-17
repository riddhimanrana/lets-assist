import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./rich-text-editor.tsx", import.meta.url),
  "utf8",
);
const onUpdate = source.slice(
  source.indexOf("onUpdate: ({ editor })"),
  source.indexOf("immediatelyRender"),
);

describe("shared rich text editor contract", () => {
  test("an update sanitizes the emitted value without rewriting the document", () => {
    expect(onUpdate).toContain("sanitizeEditorContent(editor.getHTML())");
    expect(onUpdate).toContain("onChange(canonicalHtml)");
    expect(onUpdate).not.toContain("setContent");
  });

  test("keyboard and sync decisions come from the tested policy module", () => {
    expect(source).toContain("resolveRichTextKeyIntent(event)");
    expect(source).toContain("contentSyncRef.current.receive(");
    expect(source).toContain(
      "contentSyncRef.current.recordLocalEdit(canonicalHtml)",
    );
    expect(source).toContain("contentSyncRef.current.flushOnBlur(");
    expect(source).toContain('editor.on("blur", applyDeferredContent)');
    expect(source).toContain('editor.off("blur", applyDeferredContent)');
    expect(source).toContain("event.stopPropagation()");
  });

  test("list controls are named and bound to the list commands", () => {
    expect(source).toContain('aria-label="Bulleted list"');
    expect(source).toContain('aria-label="Numbered list"');
    expect(source).toContain("toggleBulletList().run()");
    expect(source).toContain("toggleOrderedList().run()");
    expect(source).toContain('aria-pressed={editor.isActive("bulletList")}');
    expect(source).toContain('aria-pressed={editor.isActive("orderedList")}');
  });

  test("the document carries no per-node classes the saved value would lose", () => {
    expect(source).not.toContain("list-disc list-outside");
    expect(source).not.toContain("list-decimal list-outside");
    expect(source).toContain("RICH_TEXT_PROSE_CLASSNAME");
  });
});
