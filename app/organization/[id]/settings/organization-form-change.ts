function comparableValue(value: unknown) {
  return value === "" || value === undefined ? null : value;
}

/** Compare form-shaped values instead of guessing their database column names. */
export function hasOrganizationFormChanges(
  initialValues: Record<string, unknown>,
  currentValues: Record<string, unknown>,
) {
  return Object.keys(currentValues).some(
    (key) =>
      comparableValue(initialValues[key]) !==
      comparableValue(currentValues[key]),
  );
}
