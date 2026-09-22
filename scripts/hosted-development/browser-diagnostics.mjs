import { createHash } from "node:crypto";

const ORIGINS = new Map([
  ["https://dev.lets-assist.com", "application"],
  ["https://ocbuygudvarsuxijxhau.supabase.co", "development_database"],
]);
const KINDS = new Set([
  "renderer_crash",
  "page_error",
  "console_error",
  "request_failed",
  "http_error",
]);
const TABS = new Set([
  "csf-profile",
  "csf-applications",
  "csf-cohorts",
  "csf-overview",
  "csf-activities",
]);

function resource(url) {
  try {
    const parsed = new URL(url);
    const origin = ORIGINS.get(parsed.origin) ?? "external";
    let path = "other";
    if (origin === "application") {
      if (parsed.pathname.startsWith("/_next/static/")) path = "next_static";
      else if (parsed.pathname.startsWith("/organization/"))
        path = "organization";
      else if (parsed.pathname.startsWith("/api/")) path = "application_api";
      else if (parsed.pathname.startsWith("/_vercel/"))
        path = "vercel_telemetry";
      else if (parsed.pathname === "/favicon.ico") path = "favicon";
    } else if (origin === "development_database") {
      if (parsed.pathname.startsWith("/auth/")) path = "auth";
      else if (parsed.pathname.startsWith("/realtime/")) path = "realtime";
      else if (parsed.pathname.startsWith("/rest/")) path = "rest";
      else if (parsed.pathname.startsWith("/storage/")) path = "storage";
    }
    return { origin, path };
  } catch {
    return { origin: "unknown", path: "unknown" };
  }
}

function classify(text) {
  const react = text.match(/Minified React error #(\d{1,4})\b/u);
  if (react) return { category: "react", code: Number(react[1]) };
  const network = text.match(/\bnet::(ERR_[A-Z_]{1,60})\b/u);
  if (network) return { category: "network", code: network[1] };
  const status = text.match(/server responded with a status of ([45]\d{2})\b/u);
  if (status) return { category: "http", code: Number(status[1]) };
  if (text.includes("Failed to fetch RSC payload"))
    return { category: "rsc_fetch" };
  if (/hydration|hydrating/iu.test(text)) return { category: "hydration" };
  if (text.includes("DialogContent") && text.includes("DialogTitle"))
    return { category: "dialog_title" };
  if (/Content Security Policy|CORS policy/u.test(text))
    return { category: "browser_policy" };
  return { category: "unclassified" };
}

// Keep raw messages, URL parameters, console arguments and response bodies out of CI logs.
/** @param {(sample: Record<string, unknown>) => void} emit */
export function createBrowserDiagnostics(emit = () => {}) {
  const samples = [];
  let total = 0;
  return {
    /** @param {{kind: string, role: string, pageUrl?: string, url?: string, text?: string, status?: unknown}} input */
    record({ kind, role, pageUrl, url, text = "", status }) {
      if (!KINDS.has(kind) || !["member", "officer"].includes(role)) return;
      total += 1;
      if (samples.length >= 30) return;
      const boundedText = String(text).slice(0, 4096);
      let route = "unknown";
      try {
        const page = new URL(pageUrl);
        if (page.origin === "https://dev.lets-assist.com") {
          const tab = page.searchParams.get("tab");
          route = TABS.has(tab) ? tab : "home_or_other";
        }
      } catch {
        /* The page can close before an error event is delivered. */
      }
      const sample = {
        kind,
        role,
        route,
        resource: resource(url),
        ...classify(boundedText),
        fingerprint: createHash("sha256")
          .update(boundedText)
          .digest("hex")
          .slice(0, 16),
        ...(Number.isInteger(status) && status >= 400 && status <= 599
          ? { status }
          : {}),
      };
      samples.push(sample);
      emit(sample);
    },
    summarize() {
      return {
        total,
        omitted: total - samples.length,
        samples: structuredClone(samples),
      };
    },
  };
}
