/**
 * Waiver switches that may only change through the service-role,
 * organizer-scoped `apply_project_waiver_settings` RPC.
 *
 * The database refuses a browser-role write that publishes or reconfigures a
 * waiver-required project, so the generic project update must hand these three
 * columns over instead of writing them itself.
 */
export type WaiverSettingUpdates = {
  waiver_required: boolean | null;
  waiver_allow_upload: boolean | null;
  waiver_disable_esignature: boolean | null;
};

export const WAIVER_SETTING_COLUMNS = [
  "waiver_required",
  "waiver_allow_upload",
  "waiver_disable_esignature",
] as const;

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/**
 * Removes the waiver switches from a pending project update and returns them
 * separately. Returns null when the caller asked to change none of them, so an
 * ordinary edit does not touch the waiver path at all.
 */
export function extractWaiverSettingUpdates(
  updates: Record<string, unknown>,
): WaiverSettingUpdates | null {
  let requested = false;
  const extracted: WaiverSettingUpdates = {
    waiver_required: null,
    waiver_allow_upload: null,
    waiver_disable_esignature: null,
  };

  for (const column of WAIVER_SETTING_COLUMNS) {
    if (!Object.prototype.hasOwnProperty.call(updates, column)) continue;

    const value = readBoolean(updates[column]);
    delete updates[column];

    if (value === null) continue;

    extracted[column] = value;
    requested = true;
  }

  return requested ? extracted : null;
}

/**
 * User-facing reasons a waiver setting change was refused. Every string names
 * the concrete thing the organizer has to fix.
 */
export const WAIVER_SETTINGS_MESSAGES: Record<string, string> = {
  invalid_input: "Project not found.",
  project_not_found: "Project not found.",
  forbidden: "You don't have permission to change this project's waiver.",
  missing_waiver_source:
    "Upload the waiver PDF before requiring a waiver on a published project.",
  missing_storage_object:
    "The waiver PDF was not stored successfully. Please upload it again.",
  missing_waiver_definition:
    "Configure the waiver signature placements before requiring a waiver.",
  definition_source_mismatch:
    "The waiver configuration does not match the uploaded PDF. Please reconfigure it.",
  definition_missing_signature_field:
    "The waiver configuration needs at least one signature placement.",
  no_signing_mode:
    "Enable e-signatures or print-and-upload so volunteers can sign the waiver.",
};

export function getWaiverSettingsErrorMessage(outcome: string): string | null {
  if (outcome === "updated" || outcome === "unchanged") return null;

  return (
    WAIVER_SETTINGS_MESSAGES[outcome] ??
    "This project's waiver settings could not be saved."
  );
}
