/**
 * The one reader-facing label for an organization type. Unknown values fall
 * back to the stored value so a new type never renders blank.
 */
export function formatOrganizationTypeLabel(
  type: string | null | undefined,
): string {
  switch (type) {
    case "nonprofit":
      return "Nonprofit";
    case "school":
      return "Educational";
    case "company":
      return "Company";
    case "government":
      return "Government";
    case "other":
      return "Other";
    default:
      return type ?? "";
  }
}

/** Website values are stored with or without a scheme. */
export function organizationWebsiteHref(website: string): string {
  return website.startsWith("http") ? website : `https://${website}`;
}
