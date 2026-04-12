export interface WaiverPdfRequirementState {
  waiverRequired?: boolean | null;
  waiverPdfFile?: unknown;
  waiverPdfUrl?: string | null;
  waiverPdfStoragePath?: string | null;
}

export function hasRequiredWaiverPdf(state: WaiverPdfRequirementState): boolean {
  if (!state.waiverRequired) {
    return true;
  }

  const hasUrl = typeof state.waiverPdfUrl === "string" && state.waiverPdfUrl.trim().length > 0;
  const hasStoragePath =
    typeof state.waiverPdfStoragePath === "string" && state.waiverPdfStoragePath.trim().length > 0;
  const hasFile = state.waiverPdfFile !== null && state.waiverPdfFile !== undefined;

  return hasUrl || hasStoragePath || hasFile;
}

export function getWaiverPdfRequirementError(state: WaiverPdfRequirementState): string | null {
  return hasRequiredWaiverPdf(state)
    ? null
    : "A waiver PDF is required before you can continue.";
}