/**
 * Keyboard and content-sync policy for the shared rich text editor, kept free
 * of React and ProseMirror so both rules stay directly testable.
 */

export type RichTextKeyIntent =
  "open-link-dialog" | "new-paragraph" | "line-break" | "pass-through";

export type RichTextKeyEvent = {
  key: string;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
};

/** Cmd/Ctrl+Enter is left alone so a host can still bind it to submit. */
export function resolveRichTextKeyIntent(
  event: RichTextKeyEvent,
): RichTextKeyIntent {
  const hasCommandModifier = Boolean(event.metaKey || event.ctrlKey);

  if (hasCommandModifier && event.key.toLowerCase() === "k") {
    return "open-link-dialog";
  }
  if (event.key !== "Enter" || hasCommandModifier) {
    return "pass-through";
  }
  return event.shiftKey ? "line-break" : "new-paragraph";
}

/**
 * Whether an incoming `content` prop should replace the live document.
 *
 * `lastSyncedValue` is the last value the editor emitted or applied. A parent
 * that stores that value and feeds it back is echoing the editor's own work,
 * so re-applying it would only undo trailing structure the canonical form
 * omits, such as the empty paragraph Enter just created.
 */
export function shouldApplyExternalRichTextContent({
  incoming,
  editorHtml,
  lastSyncedValue,
  focused,
}: {
  incoming: string;
  editorHtml: string;
  lastSyncedValue: string | null;
  focused: boolean;
}): boolean {
  if (incoming === lastSyncedValue) return false;
  if (incoming === editorHtml) return false;
  // Resetting a focused document moves the caret and drops in-flight input.
  return !focused;
}
