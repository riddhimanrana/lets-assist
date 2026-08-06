import type { ReactNode } from "react";

/**
 * A single top-level navigation destination, used to render the phone
 * full-section switcher from the same capability-filtered inputs that build the
 * desktop category strip and utility menu.
 */
export type OrganizationNavigationDestination = {
  value: string;
  label: string;
  icon?: ReactNode;
  /** Set for destinations that navigate to their own route instead of a tab. */
  href?: string;
};

export type OrganizationNavigationDestinationGroups = {
  workspaceDestinations: OrganizationNavigationDestination[];
  utilityDestinations: OrganizationNavigationDestination[];
  switcherDestinations: OrganizationNavigationDestination[];
};

/**
 * Keeps the first destination for each value and drops later repeats, so an
 * overlapping core replacement, plugin route tab, plugin primary tab, or
 * utility tab can never render a duplicate value or React key.
 *
 * Order is preserved exactly as the caller supplied it and nothing is added,
 * which keeps server-side capability filtering the only authority over what a
 * viewer can reach. Pass a shared `seenValues` set to deduplicate across
 * several grouped lists.
 */
export function dedupeNavigationDestinations(
  destinations: ReadonlyArray<
    OrganizationNavigationDestination | null | undefined
  >,
  seenValues: Set<string> = new Set<string>(),
): OrganizationNavigationDestination[] {
  const deduped: OrganizationNavigationDestination[] = [];

  for (const destination of destinations) {
    if (
      !destination ||
      !destination.value ||
      seenValues.has(destination.value)
    ) {
      continue;
    }

    seenValues.add(destination.value);
    deduped.push(destination);
  }

  return deduped;
}

/**
 * Builds the grouped phone switcher model. Workspace destinations are
 * deduplicated first, so a utility entry repeating a workspace value renders
 * once — under its workspace group — instead of twice.
 */
export function buildNavigationDestinationGroups(
  workspaceCandidates: ReadonlyArray<
    OrganizationNavigationDestination | null | undefined
  >,
  utilityCandidates: ReadonlyArray<
    OrganizationNavigationDestination | null | undefined
  >,
): OrganizationNavigationDestinationGroups {
  const seenValues = new Set<string>();
  const workspaceDestinations = dedupeNavigationDestinations(
    workspaceCandidates,
    seenValues,
  );
  const utilityDestinations = dedupeNavigationDestinations(
    utilityCandidates,
    seenValues,
  );

  return {
    workspaceDestinations,
    utilityDestinations,
    switcherDestinations: [...workspaceDestinations, ...utilityDestinations],
  };
}

/**
 * True when a navigation item is either the active section itself or the
 * parent that owns the active child tab.
 */
export function isNavigationValueActive(
  value: string,
  activeValue: string,
  activeParentValue?: string,
): boolean {
  return (
    value === activeValue ||
    (Boolean(activeParentValue) && value === activeParentValue)
  );
}

/**
 * Resolves the destination that should read as selected: the direct match when
 * a top-level section is active, otherwise the parent that owns the active
 * child tab.
 */
export function findActiveNavigationDestination(
  destinations: ReadonlyArray<OrganizationNavigationDestination>,
  activeValue: string,
  activeParentValue?: string,
): OrganizationNavigationDestination | undefined {
  return (
    destinations.find((destination) => destination.value === activeValue) ??
    (activeParentValue
      ? destinations.find(
          (destination) => destination.value === activeParentValue,
        )
      : undefined)
  );
}
