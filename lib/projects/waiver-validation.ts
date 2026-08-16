export interface WaiverPdfRequirementState {
  waiverRequired?: boolean | null;
  waiverPdfFile?: unknown;
  waiverPdfUrl?: string | null;
  waiverPdfStoragePath?: string | null;
}

export interface WaiverSigningModeState {
  waiverRequired?: boolean | null;
  waiverAllowUpload?: boolean | null;
  waiverDisableEsignature?: boolean | null;
}

/**
 * True when volunteers have at least one way to sign the waiver.
 *
 * Turning e-signatures off leaves print-and-upload as the only signing route,
 * so both switches off is not a configuration the project could ever publish
 * with. The database refuses it too (`no_signing_mode`); this is the check that
 * says so before a project row is staged.
 */
export function hasWaiverSigningMode(state: WaiverSigningModeState): boolean {
  if (!state.waiverRequired) {
    return true;
  }

  if (!state.waiverDisableEsignature) {
    return true;
  }

  return state.waiverAllowUpload === true;
}

export function getWaiverSigningModeError(
  state: WaiverSigningModeState,
): string | null {
  return hasWaiverSigningMode(state)
    ? null
    : "Turn e-signatures back on, or allow volunteers to upload a signed copy. A waiver with neither cannot be signed.";
}

/** Every waiver configuration problem that blocks creating the project. */
export function getWaiverConfigurationError(
  state: WaiverPdfRequirementState & WaiverSigningModeState,
): string | null {
  return (
    getWaiverPdfRequirementError(state) ?? getWaiverSigningModeError(state)
  );
}

export function hasRequiredWaiverPdf(
  state: WaiverPdfRequirementState,
): boolean {
  if (!state.waiverRequired) {
    return true;
  }

  const hasUrl =
    typeof state.waiverPdfUrl === "string" &&
    state.waiverPdfUrl.trim().length > 0;
  const hasStoragePath =
    typeof state.waiverPdfStoragePath === "string" &&
    state.waiverPdfStoragePath.trim().length > 0;
  const hasFile =
    state.waiverPdfFile !== null && state.waiverPdfFile !== undefined;

  return hasUrl || hasStoragePath || hasFile;
}

export function getWaiverPdfRequirementError(
  state: WaiverPdfRequirementState,
): string | null {
  return hasRequiredWaiverPdf(state)
    ? null
    : "A waiver PDF is required before you can continue.";
}
