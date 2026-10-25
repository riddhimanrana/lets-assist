import type { WaiverSigningStep } from "./types";

/**
 * Whether the step belongs to a signer the volunteer may skip. Both of an
 * optional signer's steps, their details and their signature, are skippable.
 */
export function isSkippableStep(
  step: WaiverSigningStep | undefined,
): step is WaiverSigningStep & {
  signer: NonNullable<WaiverSigningStep["signer"]>;
} {
  return (
    !!step &&
    (step.type === "sign" || step.type === "fields") &&
    !!step.signer &&
    !step.signer.required
  );
}

/**
 * Where skipping the current optional signer lands: the first later step that
 * belongs to somebody else, past all of that signer's remaining steps. Returns
 * null when that signer's steps are the last ones, which means skipping
 * finishes the waiver.
 */
export function stepIndexAfterSkippingSigner(
  steps: WaiverSigningStep[],
  currentStepIndex: number,
): number | null {
  const roleKey = steps[currentStepIndex]?.signer?.role_key;
  if (!roleKey) return null;

  for (let index = currentStepIndex + 1; index < steps.length; index += 1) {
    if (steps[index].signer?.role_key !== roleKey) return index;
  }
  return null;
}

/**
 * Drops the values typed for skipped signers, so a half-filled guardian
 * section is not stamped onto a waiver the guardian did not sign.
 */
export function withoutSkippedSignerValues<T>(
  fieldValues: Record<string, T>,
  fields: ReadonlyArray<{ field_key: string; signer_role_key: string | null }>,
  skippedRoleKeys: ReadonlySet<string>,
): Record<string, T> {
  if (skippedRoleKeys.size === 0) return fieldValues;

  const skippedFieldKeys = new Set(
    fields
      .filter(
        (field) =>
          field.signer_role_key !== null &&
          skippedRoleKeys.has(field.signer_role_key),
      )
      .map((field) => field.field_key),
  );
  return Object.fromEntries(
    Object.entries(fieldValues).filter(([key]) => !skippedFieldKeys.has(key)),
  );
}
