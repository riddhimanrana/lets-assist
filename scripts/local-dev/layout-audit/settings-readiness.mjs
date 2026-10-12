const routes = Object.freeze({
  "organization-settings-invitations":
    "/organization/local-platform-org/settings?section=invitations",
  "organization-settings-integrations":
    "/organization/local-platform-org/settings?section=integrations",
});
export function settingsReadinessScope(entry) {
  return (
    entry?.actorKey === "developer" &&
    Object.hasOwn(routes, entry.id) &&
    entry.route === routes[entry.id] &&
    JSON.stringify(entry.expectedRoutes) === JSON.stringify([entry.route])
  );
}
export async function settleSettingsReadiness(page, entry) {
  if (!settingsReadinessScope(entry))
    throw Error("Exact settings readiness scope refused");
  await page.waitForFunction(
    () => {
      const visible = (node) =>
        node.getClientRects().length &&
        getComputedStyle(node).visibility !== "hidden" &&
        getComputedStyle(node).display !== "none" &&
        Number(getComputedStyle(node).opacity) > 0;
      return ![
        ...document.querySelectorAll(
          '[aria-busy="true"],[data-slot="skeleton"],[role="status"][aria-label^="Loading "]',
        ),
      ].some(visible);
    },
    null,
    { timeout: 12000 },
  );
  return { loadingMarkers: 0, boundedWaitMs: 12000 };
}
