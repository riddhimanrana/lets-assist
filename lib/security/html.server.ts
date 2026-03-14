import sanitizeHtml from "sanitize-html";
import {
  RICH_TEXT_ALLOWED_ATTRIBUTES,
  RICH_TEXT_ALLOWED_SCHEMES,
  RICH_TEXT_ALLOWED_TAGS,
  trimTrailingEmptyParagraphs,
} from "@/lib/security/html";

const RICH_TEXT_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...RICH_TEXT_ALLOWED_TAGS],
  allowedAttributes: RICH_TEXT_ALLOWED_ATTRIBUTES,
  allowedSchemes: [...RICH_TEXT_ALLOWED_SCHEMES],
  allowedSchemesAppliedToAttributes: ["href"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
};

export function sanitizeRichTextHtml(html: string | null | undefined): string {
  if (!html) {
    return "";
  }

  return trimTrailingEmptyParagraphs(sanitizeHtml(html, RICH_TEXT_SANITIZE_OPTIONS));
}