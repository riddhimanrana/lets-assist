import type { OrganizationPluginDataAccessDeclaration } from "@/types/plugin";

/** Defensive cap on plugin name written freely by the plugin author. */
const MAX_PLUGIN_NAME_LENGTH = 80;
/**
 * Deduplicated, human-readable purposes are shown directly in the short
 * summary sentence. Keeping this small is what bounds summary length no
 * matter how many `dataAccess` relations a plugin declares (DVHS CSF alone
 * declares 40+).
 */
const MAX_SUMMARY_CATEGORIES = 3;
/**
 * A larger, still-bounded list for an optional scrollable detail
 * disclosure in the confirmation dialog. Never large enough to approach
 * the old unbounded join of every declared relation.
 */
const MAX_DISCLOSURE_CATEGORIES = 20;
/** Defensive cap on a single purpose string, which a plugin author writes freely. */
const MAX_CATEGORY_LABEL_LENGTH = 100;

export type DescribePluginUninstallImpactInput = {
  pluginName: string;
  /**
   * Human-readable purposes only (e.g. manifest `dataAccess[].purpose`).
   * Never pass internal schema/relation/table identifiers here — this
   * whole type exists so the confirmation dialog and the success toast
   * never have to interpolate that kind of string into UI copy.
   */
  dataAccessPurposes: string[];
};

export type PluginUninstallImpact = {
  /** Deduplicated, length-capped purposes, bounded to MAX_DISCLOSURE_CATEGORIES, for an optional detail list. */
  dataCategories: string[];
  /** How many additional deduplicated categories exist beyond `dataCategories`. */
  additionalDataCategoryCount: number;
  /**
   * The data-handling sentence alone, for UI that renders the destructive
   * "workflows stop, settings removed" warning as separate, differently-styled
   * copy rather than folding it into one paragraph. Length-bounded regardless
   * of declared category count.
   */
  retentionClause: string;
  /**
   * Full paragraph combining the destructive-settings warning and
   * `retentionClause`, for toasts and other plain-text contexts.
   * Length-bounded regardless of declared category count.
   */
  summary: string;
};

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

/**
 * Pull deduplicated, human-readable purposes out of a manifest's
 * `dataAccess` declarations — never the `schema`/`relation` identifiers.
 * The one place this extraction happens, so the install-consent inventory
 * (which still shows the full `access: schema.relation - purpose` strings
 * elsewhere, unchanged), the uninstall confirmation dialog, and the
 * uninstall success toast all derive their category list from the same
 * logic instead of three independently-maintained copies.
 */
export function extractDataAccessPurposes(
  dataAccess: OrganizationPluginDataAccessDeclaration[] | undefined,
): string[] {
  return Array.from(
    new Set(
      (dataAccess ?? [])
        .map((entry) => entry.purpose?.trim())
        .filter((purpose): purpose is string => Boolean(purpose)),
    ),
  );
}

/**
 * Describe what uninstalling a plugin actually does, for confirmation
 * copy and post-action messaging. This does not run any lifecycle hook and
 * does not touch the database — it states the platform's own contract:
 * `runPluginUninstall`/`removeInstall` (see control-plane-transition-core.ts)
 * only ever delete the install row. Permanent erasure of `plugin_data` is a
 * distinct, currently unwired hook (`onDataDelete` / `runPluginDataDelete`),
 * so this deliberately does not claim a self-service way to request it.
 *
 * Takes plain data rather than a full `OrganizationPluginDefinition` so the
 * confirmation dialog (client component, working from the admin-settings
 * DTO) and the success-toast message (server action, working from the
 * registered plugin definition) can call the exact same function instead of
 * drifting into two different summaries — one of which used to interpolate
 * raw `schema.relation` identifiers.
 */
export function describePluginUninstallImpact(
  input: DescribePluginUninstallImpactInput,
): PluginUninstallImpact {
  const pluginName = truncate(input.pluginName, MAX_PLUGIN_NAME_LENGTH);
  const { dataAccessPurposes } = input;

  const dedupedCategories = Array.from(
    new Set(
      dataAccessPurposes
        .map((purpose) => truncate(purpose.trim(), MAX_CATEGORY_LABEL_LENGTH))
        .filter((purpose) => purpose.length > 0),
    ),
  );

  const dataCategories = dedupedCategories.slice(0, MAX_DISCLOSURE_CATEGORIES);
  const additionalDataCategoryCount = Math.max(
    0,
    dedupedCategories.length - dataCategories.length,
  );
  const totalDataCategoryCount = dedupedCategories.length;

  const summaryCategories = dedupedCategories.slice(0, MAX_SUMMARY_CATEGORIES);
  const summaryOverflow = Math.max(
    0,
    totalDataCategoryCount - summaryCategories.length,
  );

  // The platform's own uninstall does not request plugin-data deletion — it
  // only removes the install row and its configuration. The plugin's own hook
  // runs before that removal with the service role and is not constrained by
  // the platform, so the platform cannot certify what it does.
  const retentionFact = totalDataCategoryCount
    ? `The platform's own uninstall does not request deletion of the ${totalDataCategoryCount} declared data categor${totalDataCategoryCount === 1 ? "y" : "ies"} (${summaryCategories.join("; ")}${summaryOverflow > 0 ? `, +${summaryOverflow} more` : ""}) — it removes only the install record and its configuration. The plugin's own hook runs before that removal and is not constrained by the platform.`
    : "The platform's own uninstall does not request plugin-data deletion — it removes only the install record and its configuration. The plugin's own hook runs before that removal and is not constrained by the platform.";
  const retentionClause = `${retentionFact} The product currently has no self-service or support-triggered path to permanently erase stored plugin data.`;

  return {
    dataCategories,
    additionalDataCategoryCount,
    retentionClause,
    summary: `Uninstalling ${pluginName} immediately removes its saved settings and disables plugin surfaces; already-queued work may still complete. This cannot be undone. ${retentionClause}`,
  };
}
