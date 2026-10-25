const routes = Object.freeze({
  "csf-settings": "/organization/dvhs-csf?tab=csf-settings",
  "organization-settings-plugins":
    "/organization/local-platform-org/settings?section=plugins",
  "organization-settings-invitations":
    "/organization/local-platform-org/settings?section=invitations",
  "organization-settings-integrations":
    "/organization/local-platform-org/settings?section=integrations",
});
export function settingsReadinessScope(entry) {
  return (
    entry?.actorKey ===
      (entry?.id === "csf-settings" ? "csfAdmin" : "developer") &&
    Object.hasOwn(routes, entry.id) &&
    entry.route === routes[entry.id] &&
    JSON.stringify(entry.expectedRoutes) === JSON.stringify([entry.route])
  );
}
export async function settleSettingsReadiness(page, entry) {
  if (!settingsReadinessScope(entry))
    throw Error("Exact settings readiness scope refused");
  await page.waitForFunction(
    (isCsfSettings = false) => {
      const visible = (node) =>
        node.getClientRects().length &&
        getComputedStyle(node).visibility !== "hidden" &&
        getComputedStyle(node).display !== "none" &&
        Number(getComputedStyle(node).opacity) > 0;
      const markers =
        '[aria-busy="true"],[data-slot="skeleton"],[role="status"][aria-label^="Loading "]';
      // A failed status action can render a disconnected label with an alert.
      // That error is not a successfully loaded disconnected fixture.
      const selector = isCsfSettings
        ? markers +
          ',section[aria-label="Google Drive connection"] [role="alert"]'
        : markers;
      return ![...document.querySelectorAll(selector)].some(visible);
    },
    entry.id === "csf-settings",
    { timeout: 12000 },
  );
  if (entry.id === "csf-settings") {
    // Inactive organization tabs retain cached markup. Scope text waits through
    // the accessible panel so a hidden copy cannot provide or block readiness.
    const panel = page.getByRole("tabpanel");
    await panel
      .getByRole("region", { name: "Google Drive connection", exact: true })
      .getByText("Connect Google to select Sheets and Drive files.", {
        exact: true,
      })
      .waitFor({ state: "visible", timeout: 12000 });
    await panel
      .getByRole("region", { name: "Sheet sync", exact: true })
      .getByText(
        "No export destinations configured. Source imports are managed from the class or application workspace.",
        { exact: true },
      )
      .waitFor({ state: "visible", timeout: 12000 });
  }
  return { loadingMarkers: 0, boundedWaitMs: 12000 };
}
