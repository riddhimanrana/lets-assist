export type WaiverSignerIdentityInput = {
  signerNameInput?: string | null;
  signerEmailInput?: string | null;
  sessionEmail?: string | null;
  sessionFullName?: string | null;
  guestName?: string | null;
  guestEmail?: string | null;
  isSessionActor: boolean;
};

/**
 * Resolves the identity recorded on a waiver signature.
 *
 * A session actor always signs under the verified session email, so a
 * client-supplied signer address can never rename the evidence. A guest signs
 * under the address that just passed the guest gates, falling back to the
 * submitted signer address only when no guest address was collected.
 */
export function resolveWaiverSignerIdentity(
  params: WaiverSignerIdentityInput,
): { signerName: string; signerEmail: string } | null {
  const signerName =
    (params.signerNameInput || "").trim() ||
    (params.guestName || "").trim() ||
    (params.sessionFullName || "").trim() ||
    "Volunteer";

  const signerEmail = params.isSessionActor
    ? (params.sessionEmail || "").trim()
    : (params.guestEmail || "").trim() ||
      (params.signerEmailInput || "").trim();

  if (!signerEmail) return null;

  return { signerName, signerEmail };
}
