import type {
  SignaturePayload,
  SignaturePreviewSigner,
  SignaturePreviewSummary,
} from "@/types/waiver-definitions";

function hasValue(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function buildSignaturePreviewSummary(
  payload: SignaturePayload | null | undefined,
): SignaturePreviewSummary | null {
  if (!payload || !Array.isArray(payload.signers) || payload.signers.length === 0) {
    return null;
  }

  const signers: SignaturePreviewSigner[] = payload.signers.map((signer) => ({
    role_key: signer.role_key,
    method: signer.method,
    timestamp: signer.timestamp,
    ...(hasValue(signer.signer_name) ? { signer_name: signer.signer_name } : {}),
    ...(hasValue(signer.signer_email) ? { signer_email: signer.signer_email } : {}),
  }));

  return {
    signerCount: signers.length,
    signers,
  };
}