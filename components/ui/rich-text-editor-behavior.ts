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

/** Ignore parent echoes without delaying a new external document. */
export function createRichTextContentSync() {
  let lastSyncedValue: string | null = null;
  const recentLocalValues: string[] = [];

  return {
    receive(incoming: string, editorHtml: string) {
      // A parent echo may omit a trailing empty paragraph the author just made.
      if (incoming === lastSyncedValue) return null;
      // A delayed echo of an older keystroke must not replace the newer draft.
      if (recentLocalValues.includes(incoming)) return null;
      if (incoming === editorHtml) {
        lastSyncedValue = incoming;
        return null;
      }
      lastSyncedValue = incoming;
      return incoming;
    },
    recordLocalEdit(html: string) {
      lastSyncedValue = html;
      recentLocalValues.push(html);
      if (recentLocalValues.length > 32) recentLocalValues.shift();
      return true;
    },
  };
}
