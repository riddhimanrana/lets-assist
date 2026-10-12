// Only validated scene IDs, fixed states and bounded counters enter CI logs.
const modes = new Set([
  "desktop-light",
  "desktop-dark",
  "phone-light",
  "phone-dark",
  "desktop-light-reduced",
]);
const states = new Set([
  "captured-awaiting-pixel-review",
  "captured-loading-present",
  "blocked-or-failed",
]);
const faultNames = [
  "pageErrors",
  "consoleErrors",
  "http5xx",
  "blockedExternal",
  "blockedMutation",
  "blockedSocket",
  "unsafeNavigation",
];
function count(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1000000)
    throw Error("Capture summary counter refused");
  return value;
}
export function captureSummary(final, scenes) {
  const statusCounts = Object.fromEntries([...states].map((s) => [s, 0]));
  let images = 0;
  const blocked = [];
  if (
    !Array.isArray(final.results) ||
    final.results.length > 435 ||
    typeof final.finalDriftVerified !== "boolean" ||
    typeof final.executionFailure !== "boolean"
  )
    throw Error("Capture summary receipt refused");
  for (const row of final.results) {
    if (
      !scenes.has(row.id) ||
      !/^[a-z0-9-]{1,90}$/u.test(row.id) ||
      !modes.has(row.mode) ||
      !states.has(row.status)
    )
      throw Error("Capture summary scene refused");
    statusCounts[row.status]++;
    if (row.image) images++;
    if (row.status === "blocked-or-failed")
      blocked.push({
        id: row.id,
        mode: row.mode,
        faults: Object.fromEntries(
          faultNames.map((name) => [name, count(row.faults?.[name])]),
        ),
      });
  }
  return {
    layoutCaptureSummary: true,
    attempted: final.results.length,
    images,
    statusCounts,
    blocked,
    finalDriftVerified: final.finalDriftVerified,
    executionFailure: final.executionFailure,
    completeVisualAudit: false,
    pixelsInspected: 0,
  };
}
