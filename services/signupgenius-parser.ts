import type { ImportPreview } from "@/lib/signupgenius/model";
import { readJsonLdDocuments } from "./signupgenius-jsonld-source";
import { projectJsonLdEvent } from "./signupgenius-jsonld-event";

/** Documented structured-data semantics only; never guessed provider selectors. */
export function parsePublicSignUpGenius(
  html: string,
  sourceUrl: string,
): ImportPreview {
  // Standards-backed structured data only. SUG-specific markup remains unverified.
  return projectJsonLdEvent(readJsonLdDocuments(html), sourceUrl);
}
