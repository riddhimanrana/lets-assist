/**
 * Typography shared by the editable surface and the saved content renderer, so
 * paragraphs and lists look the same before and after publishing. Markers are
 * set here because class attributes are not part of the canonical sanitized
 * value and cannot travel with the content.
 */
export const RICH_TEXT_PROSE_CLASSNAME =
  "prose prose-sm dark:prose-invert max-w-none [&_p]:my-0.5 [&_ul]:my-0.5 [&_ol]:my-0.5 [&_li]:my-0 [&_li_p]:my-0 [&_p]:min-h-[1.5em] [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 text-foreground prose-headings:text-foreground prose-p:text-foreground prose-strong:text-foreground prose-li:text-foreground";
