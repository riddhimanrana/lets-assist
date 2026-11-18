import { SignUpGeniusImportError } from "@/lib/signupgenius/errors";
import type { ImportPreview } from "@/lib/signupgenius/model";

/** Source adapters must be backed by inspected public markup, never guessed selectors. */
export function parsePublicSignUpGenius(
  _html: string,
  _sourceUrl: string,
): ImportPreview {
  // Fail closed while the supported public markup contract is being verified.
  throw new SignUpGeniusImportError("unsupported");
}
