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

/** Keep parent echoes out of the document while retaining external edits until blur. */
export function createRichTextContentSync() {
  let lastSyncedValue: string | null = null;
  let deferredContent: string | null = null;

  return {
    receive(incoming: string, editorHtml: string, focused: boolean) {
      // A parent echo may omit a trailing empty paragraph the author just made.
      if (incoming === lastSyncedValue) return null;
      if (incoming === editorHtml) {
        deferredContent = null;
        lastSyncedValue = incoming;
        return null;
      }
      if (focused) {
        deferredContent = incoming;
        return null;
      }
      deferredContent = null;
      lastSyncedValue = incoming;
      return incoming;
    },
    recordLocalEdit(html: string) {
      // Do not send an older document over an external value waiting for blur.
      if (deferredContent !== null) return false;
      lastSyncedValue = html;
      return true;
    },
    flushOnBlur(editorHtml: string) {
      const incoming = deferredContent;
      if (incoming === null) return null;
      deferredContent = null;
      lastSyncedValue = incoming;
      return incoming === editorHtml ? null : incoming;
    },
  };
}
