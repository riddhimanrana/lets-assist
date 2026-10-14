export const pageErrorPhases = Object.freeze([
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
  "comparison-settlement",
  "axe-after-comparison",
  "dom-before-png",
  "output-preflight",
  "png-capture",
]);

const kinds = new Set([
  "Error",
  "TypeError",
  "ReferenceError",
  "SyntaxError",
  "RangeError",
  "URIError",
  "EvalError",
]);
const assetName =
  /^(?:(?:[0-9]{1,8}|page|layout|webpack|main-app|error|global-error|not-found)-)?[a-f0-9]{8,64}\.js$/u;

function field(error, key) {
  try {
    const value = error?.[key];
    return typeof value === "string" ? value.slice(0, 16_384) : "";
  } catch {
    return "";
  }
}

export function recordPageError(error, state) {
  state.faults.pageErrors++;
  if (!state.publicLanding) return;
  state.capture.pageErrorDiagnostics ??= [];
  if (state.capture.pageErrorDiagnostics.length >= 3) return;
  state.capture.pageErrorDiagnostics.push(
    publicPageErrorDiagnostic(error, state),
  );
}

export function publicPageErrorDiagnostic(
  error,
  { phase, baseURL, scriptURLs = new Set() },
) {
  const name = field(error, "name");
  const message = field(error, "message");
  const diagnostic = {
    schema: "lets-assist-public-page-error-v1",
    phase: pageErrorPhases.includes(phase) ? phase : "unknown",
    kind: kinds.has(name) ? name : "other",
    category: "unclassified",
    source: null,
  };
  const react = message.match(/Minified React error #([0-9]{1,4})\b/u);
  if (react && Number(react[1]) > 0) {
    diagnostic.category = "react-minified";
    diagnostic.reactCode = Number(react[1]);
  } else if (/Maximum update depth exceeded/u.test(message)) {
    diagnostic.category = "react-update-depth";
  } else if (/Cannot read properties of (?:undefined|null)/u.test(message)) {
    diagnostic.category = "property-access";
  } else if (/is not defined\b/u.test(message) && name === "ReferenceError") {
    diagnostic.category = "missing-reference";
  } else if (
    /Loading chunk [0-9]+ failed|Failed to fetch dynamically imported module/u.test(
      message,
    )
  ) {
    diagnostic.category = "chunk-load";
  } else if (/ResizeObserver loop/u.test(message)) {
    diagnostic.category = "resize-observer";
  }
  // Only a delivered, same-origin Next asset with a generated filename may
  // identify a source. Never retain messages, function names, routes, query
  // strings, cookies, actor values, or arbitrary stack text.
  const frames = field(error, "stack").matchAll(
    /(https?:\/\/[^\s()]+\.js):([0-9]{1,7}):([0-9]{1,7})\b/gu,
  );
  for (const frame of frames) {
    try {
      const url = new URL(frame[1]);
      if (
        url.origin !== new URL(baseURL).origin ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !url.pathname.startsWith("/_next/static/") ||
        !scriptURLs.has(url.href)
      )
        continue;
      const file = url.pathname.split("/").at(-1);
      const line = Number(frame[2]);
      const column = Number(frame[3]);
      if (!assetName.test(file) || line < 1 || column < 1) continue;
      diagnostic.source = { file, line, column };
      break;
    } catch {
      // Invalid or private source text provides no source receipt.
    }
  }
  return diagnostic;
}
