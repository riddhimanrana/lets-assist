// Retired properties validate saved configuration but have no editable control.
// This presentation hint does not authorize or reactivate any plugin behavior.
export function editableConfigProperties<
  T extends { format?: string },
>(schema: { properties: Record<string, T> }): Array<[string, T]> {
  return Object.entries(schema.properties).filter(
    ([, property]) => property.format !== "retired",
  );
}
