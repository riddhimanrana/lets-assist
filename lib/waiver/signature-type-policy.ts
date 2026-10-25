/**
 * Which signature types a project accepts, decided on the server.
 *
 * The signing dialog only ever sends `multi-signer` (e-signature) or `upload`
 * (a printed and signed copy). The single-value `draw` and `typed` types exist
 * for projects with no waiver definition, so a crafted request must not be able
 * to use them to satisfy a definition with one string, or to e-sign a project
 * that turned e-signatures off.
 */

const KNOWN_SIGNATURE_TYPES = new Set([
  "draw",
  "typed",
  "upload",
  "multi-signer",
]);

export const ESIGNATURE_DISABLED_MESSAGE =
  "This project only accepts a printed and signed waiver. Upload your signed copy to continue.";

export const DEFINITION_REQUIRES_SIGNING_FORM_MESSAGE =
  "This waiver has to be signed in the signing form. Reload the page and sign again.";

export const UNSUPPORTED_SIGNATURE_TYPE_MESSAGE =
  "This waiver signature type is not supported.";

/** Returns the reason a signature type is refused, or null when it is allowed. */
export function waiverSignatureTypeError(input: {
  signatureType: unknown;
  /** The project points at a waiver definition (`waiver_definition_id`). */
  hasDefinition: boolean;
  /** The project has `waiver_disable_esignature` set. */
  disableEsignature: boolean;
}): string | null {
  const { signatureType } = input;

  if (
    typeof signatureType !== "string" ||
    !KNOWN_SIGNATURE_TYPES.has(signatureType)
  ) {
    return UNSUPPORTED_SIGNATURE_TYPE_MESSAGE;
  }

  if (input.disableEsignature && signatureType !== "upload") {
    return ESIGNATURE_DISABLED_MESSAGE;
  }

  if (
    input.hasDefinition &&
    (signatureType === "draw" || signatureType === "typed")
  ) {
    return DEFINITION_REQUIRES_SIGNING_FORM_MESSAGE;
  }

  return null;
}
