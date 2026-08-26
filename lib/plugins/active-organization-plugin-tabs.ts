import type { OrganizationTabBehavior } from "@/types";

export function resolveOrganizationTabAlias(
  value: string,
  aliases: Readonly<Record<string, string>> | undefined,
) {
  let resolvedValue = value;
  const visited = new Set<string>();

  while (aliases?.[resolvedValue] && !visited.has(resolvedValue)) {
    visited.add(resolvedValue);
    resolvedValue = aliases[resolvedValue];
  }

  return resolvedValue;
}

export function resolveActiveOrganizationTab(input: {
  requestedTab: string | string[] | undefined;
  defaultTab: string | undefined;
  aliases: Readonly<Record<string, string>> | undefined;
  availableTabs?: readonly string[];
}) {
  const requestedTab = Array.isArray(input.requestedTab)
    ? input.requestedTab[0]
    : input.requestedTab;
  const resolvedTab = resolveOrganizationTabAlias(
    requestedTab || input.defaultTab || "overview",
    input.aliases,
  );
  if (!input.availableTabs || input.availableTabs.includes(resolvedTab)) {
    return resolvedTab;
  }

  const resolvedDefault = resolveOrganizationTabAlias(
    input.defaultTab || "overview",
    input.aliases,
  );
  return input.availableTabs.includes(resolvedDefault)
    ? resolvedDefault
    : (input.availableTabs[0] ?? "overview");
}

/**
 * Async Server Component children execute when React traverses them. Keep the
 * tab descriptors for client navigation, but remove every inactive child
 * before the server render so one organization route cannot load every plugin
 * workspace at once.
 */
export function projectActiveOrganizationPluginTabs(
  tabs: readonly OrganizationTabBehavior[],
  activeTab: string,
): OrganizationTabBehavior[] {
  return tabs.map((tab) => ({
    ...tab,
    content: tab.value === activeTab ? tab.content : null,
  }));
}
