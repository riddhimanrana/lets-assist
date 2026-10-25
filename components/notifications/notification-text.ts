/**
 * Notification text is written by the database, and some of it carries stored
 * codes such as `inappropriate_content`. Shown to a person, a code reads as
 * plain words: "inappropriate content".
 */
export function readableNotificationText(text: string | null | undefined) {
  if (!text) return "";
  return text.replace(/\b[a-z]+(?:_[a-z]+)+\b/g, (code) =>
    code.replaceAll("_", " "),
  );
}
