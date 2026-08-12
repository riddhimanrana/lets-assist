/** Defensive cap matching the organization-name limit enforced elsewhere in settings UI. */
const MAX_ORGANIZATION_NAME_LENGTH = 200;
/** Defensive cap; plugin keys are short, stable identifiers, never free text. */
const MAX_PLUGIN_KEY_LENGTH = 100;

/**
 * The exact phrase an organization admin must type to confirm permanent
 * plugin-data deletion. The stable organization UUID prevents same-named
 * organizations from sharing a phrase; the human name makes the scope
 * recognizable; and the plugin key binds the exact extension.
 *
 * Used identically by the confirmation dialog (to show what to type) and
 * by the server action (to verify what was typed) so the two can never
 * drift into checking different strings.
 */
export function buildPluginDataDeletionConfirmationPhrase(
  organizationName: string,
  organizationId: string,
  pluginKey: string,
): string {
  const boundedName = organizationName.slice(0, MAX_ORGANIZATION_NAME_LENGTH);
  const boundedId = organizationId.slice(0, 64);
  const boundedKey = pluginKey.slice(0, MAX_PLUGIN_KEY_LENGTH);
  return `${boundedName}/${boundedId}/${boundedKey}`;
}
