// Only validated scene IDs, fixed states and bounded counters enter CI logs.
import { restingFailureDiagnostic } from "./capture-resting-state.mjs";
const modes = new Set([
  "desktop-light",
  "desktop-dark",
  "phone-light",
  "phone-dark",
  "desktop-light-reduced",
]);
const states = new Set(["captured-awaiting-pixel-review", "blocked-or-failed"]);
const capturePhases = new Set([
  "navigation",
  "ui-inspection",
  "loaded-landmarks",
  "initial-assets",
  "axe-before-keyboard",
  "keyboard",
  "resting-state",
  "landing-settlement",
  "axe-after-landing",
  "fonts-before-png",
  "landing-static-settlement",
  "axe-after-static-landing",
  "dom-before-png",
  "output-preflight",
  "png-capture",
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
const requestRefusalCategories = new Set([
  "reviewed-platform-reader-refused",
  "reviewed-invitation-reader-refused",
  "reviewed-integration-reader-refused",
  "reviewed-plugin-reader-refused",
  "reviewed-csf-settings-reader-refused",
  "unreviewed-request",
]);
const externalRefusalCategories = new Set([
  "local-image-optimizer",
  "remote-image-optimizer",
  "app-origin",
  "isolated-api",
  "alternate-loopback",
  "production-api",
  "video",
  "vercel-script",
  "other-external",
  "invalid-url",
]);
export function externalRequestCategory(value, baseURL, supabaseOrigin) {
  try {
    const url = new URL(value);
    if (url.origin === baseURL) {
      if (url.pathname === "/_next/image")
        return url.searchParams.get("url")?.startsWith("/")
          ? "local-image-optimizer"
          : "remote-image-optimizer";
      return "app-origin";
    }
    if (url.origin === supabaseOrigin) return "isolated-api";
    if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      return "alternate-loopback";
    if (url.hostname === "api.lets-assist.com") return "production-api";
    if (["www.youtube.com", "img.youtube.com"].includes(url.hostname))
      return "video";
    if (url.hostname === "va.vercel-scripts.com") return "vercel-script";
    return "other-external";
  } catch {
    return "invalid-url";
  }
}
export function readRequestRefusalCategory(actionId, groups) {
  for (const [name, actions] of [
    ["platform", groups.platform],
    ["invitation", groups.invitation],
    ["integration", groups.integration],
    ["plugin", groups.plugin],
    ["csf-settings", groups.csfSettings],
  ])
    if (
      typeof actionId === "string" &&
      actions?.some((a) => a.actionId === actionId)
    )
      return `reviewed-${name}-reader-refused`;
  return "unreviewed-request";
}
function count(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1000000)
    throw Error("Capture summary counter refused");
  return value;
}
export function assertCaptureDomReady(dom) {
  if (dom?.loadingIndicators !== 0)
    throw Error("Capture has unresolved loading markers");
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
    if (row.status === "captured-awaiting-pixel-review")
      assertCaptureDomReady(row.dom);
    if (row.image) images++;
    if (row.status === "blocked-or-failed") {
      if (!capturePhases.has(row.phaseAtFailure))
        throw Error("Capture failure phase refused");
      const requestRefusals = row.requestRefusals ?? [];
      const externalRefusals = row.externalRefusals ?? [];
      if (
        !Array.isArray(requestRefusals) ||
        requestRefusals.length > 4 ||
        requestRefusals.some(
          (category) => !requestRefusalCategories.has(category),
        ) ||
        !Array.isArray(externalRefusals) ||
        externalRefusals.length > 4 ||
        externalRefusals.some(
          (category) => !externalRefusalCategories.has(category),
        )
      )
        throw Error("Capture request refusal category refused");
      const restingFailure =
        row.restingFailure === undefined
          ? undefined
          : restingFailureDiagnostic(row.restingFailure);
      if (restingFailure && row.phaseAtFailure !== "resting-state")
        throw Error("Resting diagnostic phase refused");
      blocked.push({
        id: row.id,
        mode: row.mode,
        phaseAtFailure: row.phaseAtFailure,
        faults: Object.fromEntries(
          faultNames.map((name) => [name, count(row.faults?.[name])]),
        ),
        requestRefusals,
        externalRefusals,
        ...(restingFailure ? { restingFailure } : {}),
      });
    }
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
