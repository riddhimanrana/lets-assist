export const SETTINGS_SECTIONS = [
  {
    value: "general",
    label: "General",
    description: "Your organization's profile and verification.",
  },
  {
    value: "members",
    label: "Members",
    description: "Who can see your members and how to export the list.",
  },
  {
    value: "invitations",
    label: "Invitations",
    description: "Join code, staff link and email invitations.",
  },
  {
    value: "integrations",
    label: "Integrations",
    description: "Connect Google Calendar and Google Sheets.",
  },
  {
    value: "plugins",
    label: "Plugins",
    description: "Extra features installed for this organization.",
  },
  {
    value: "danger",
    label: "Danger zone",
    description: "Actions that cannot be undone.",
  },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["value"];

/**
 * Google OAuth returns to `?section=calendar` or `?section=sheets`, and each
 * integration card reads that value to show its result, so both stay valid
 * and open the Integrations section.
 */
const SECTION_ALIASES: Record<string, SettingsSectionId> = {
  calendar: "integrations",
  sheets: "integrations",
};

export function resolveSettingsSection(
  value: string | null | undefined,
): SettingsSectionId {
  if (!value) return "general";
  const match = SETTINGS_SECTIONS.find((section) => section.value === value);
  return match ? match.value : (SECTION_ALIASES[value] ?? "general");
}
