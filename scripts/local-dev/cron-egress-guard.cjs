"use strict";

/**
 * Run-scoped egress guard for every isolated DVHS CSF child process.
 *
 * Two callers load it with `--require`, and its evidence covers both:
 *
 *   - `scripts/local-dev/run-dvhs-csf-isolated-app.mjs`, the isolated app runner
 *     on port 3000, and
 *   - `scripts/local-dev/test-cron-endpoints.ts`, the six-route cron auth/shape
 *     harness (and the harness process itself).
 *
 * In both cases it rejects and records every HTTP(S) request whose host is not
 * loopback, and every raw socket to a non-loopback host.
 *
 * The two callers differ in exactly one axis, expressed as data rather than as a
 * second copy of this file:
 *
 *   - CRON_EGRESS_SMTP_PORTS declares which extra ports count as SMTP;
 *   - CRON_EGRESS_ALLOWED_SMTP_PORTS permits specific loopback SMTP ports;
 *   - CRON_EGRESS_ALLOWED_LOOPBACK_PORTS, when set, restricts loopback traffic
 *     to exactly those ports.
 *
 * The app runner permits its own validated Mailpit port — local mail is the
 * point of Mailpit — and nothing else beyond loopback Supabase, the loopback
 * database, and the local app. The cron harness permits no SMTP at all: "the
 * mail went to Mailpit instead of a real inbox" is a property of the local
 * environment rather than of the code under test, so the probe's claim is the
 * stronger, falsifiable one — it attempted no provider egress whatsoever.
 *
 * Every refusal is appended to the run-scoped ledger as one JSON object per
 * line, so a caller can assert an exact zero rather than trusting that nothing
 * was logged.
 */

const fs = require("node:fs");
const net = require("node:net");
const http = require("node:http");
const https = require("node:https");

const LEDGER_PATH = process.env.CRON_EGRESS_LEDGER;
if (!LEDGER_PATH) {
  throw new Error(
    "cron-egress-guard requires CRON_EGRESS_LEDGER; refusing to run unguarded.",
  );
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]", ""]);

function portSet(value) {
  const ports = new Set();
  for (const raw of (value || "").split(",")) {
    const port = Number(raw.trim());
    if (Number.isInteger(port) && port > 0) ports.add(port);
  }
  return ports;
}

// Well-known SMTP submission ports plus whatever the isolated stack allocated
// for Mailpit, supplied by the caller from the validated marker.
const SMTP_PORTS = new Set([25, 465, 587, 2525]);
for (const port of portSet(process.env.CRON_EGRESS_SMTP_PORTS))
  SMTP_PORTS.add(port);

// Loopback SMTP the caller has explicitly permitted. The app runner names its
// own validated Mailpit port here; the cron harness names none.
const ALLOWED_SMTP_PORTS = portSet(process.env.CRON_EGRESS_ALLOWED_SMTP_PORTS);

// When non-empty, loopback traffic is restricted to exactly these ports, so an
// arbitrary loopback service is refused rather than reached. When empty, every
// loopback port stays reachable — the cron harness relies on that, because the
// isolated Supabase API and database live on loopback too.
const ALLOWED_LOOPBACK_PORTS = portSet(
  process.env.CRON_EGRESS_ALLOWED_LOOPBACK_PORTS,
);

function isRefusedSmtpPort(port) {
  return SMTP_PORTS.has(port) && !ALLOWED_SMTP_PORTS.has(port);
}

// A loopback port outside an explicitly declared allowlist. SMTP is decided
// separately above, so an allowed Mailpit port is never refused twice.
function isRefusedLoopbackPort(port) {
  if (ALLOWED_LOOPBACK_PORTS.size === 0) return false;
  if (!Number.isInteger(port) || port <= 0) return false;
  return !ALLOWED_LOOPBACK_PORTS.has(port);
}

function record(kind, target, detail) {
  const entry = JSON.stringify({
    kind,
    target,
    detail: detail || null,
    pid: process.pid,
  });
  try {
    fs.appendFileSync(LEDGER_PATH, `${entry}\n`);
  } catch {
    // A ledger that cannot be written must not silently swallow the refusal.
    process.stderr.write(`cron-egress-guard: unrecordable refusal ${entry}\n`);
  }
}

function refuse(kind, target, detail) {
  record(kind, target, detail);
  return new Error(
    `cron-egress-guard refused ${kind} to ${target}: an isolated DVHS CSF child must not egress.`,
  );
}

function defaultPortFor(protocol) {
  if (protocol === "https:") return 443;
  if (protocol === "http:") return 80;
  return 0;
}

function isLoopbackHost(hostname) {
  if (!hostname) return true;
  return LOOPBACK_HOSTS.has(String(hostname).toLowerCase());
}

// --------------------------------------------------------------------------
// fetch
// --------------------------------------------------------------------------
const realFetch = globalThis.fetch;
if (typeof realFetch === "function") {
  globalThis.fetch = function guardedFetch(input, init) {
    let target = "";
    try {
      target =
        typeof input === "string"
          ? input
          : input && typeof input.url === "string"
            ? input.url
            : String(input);
      const url = new URL(target);
      if (!isLoopbackHost(url.hostname)) {
        return Promise.reject(refuse("fetch", url.origin, url.pathname));
      }
      const port = url.port ? Number(url.port) : defaultPortFor(url.protocol);
      if (isRefusedSmtpPort(port)) {
        return Promise.reject(refuse("smtp-fetch", url.origin, url.pathname));
      }
      if (isRefusedLoopbackPort(port)) {
        return Promise.reject(
          refuse("loopback-fetch", url.origin, url.pathname),
        );
      }
    } catch {
      // A target we cannot parse is a target we cannot prove is loopback.
      return Promise.reject(refuse("fetch", target || "<unparseable>", null));
    }
    return realFetch.call(this, input, init);
  };
}

// --------------------------------------------------------------------------
// http / https
// --------------------------------------------------------------------------
function guardRequest(module, name, scheme) {
  const original = module[name];
  module[name] = function guarded(...args) {
    let host = "";
    let port = 0;
    const first = args[0];
    try {
      if (typeof first === "string") {
        const url = new URL(first);
        host = url.hostname;
        port = Number(url.port);
      } else if (first instanceof URL) {
        host = first.hostname;
        port = Number(first.port);
      } else if (first && typeof first === "object") {
        host = first.hostname || first.host || "";
        port = Number(first.port);
        if (host.includes(":")) host = host.split(":")[0];
      }
    } catch {
      throw refuse(scheme, "<unparseable>", name);
    }
    if (!isLoopbackHost(host)) {
      throw refuse(
        scheme,
        `${scheme}://${host}${port ? `:${port}` : ""}`,
        name,
      );
    }
    if (!port) port = defaultPortFor(`${scheme}:`);
    if (isRefusedSmtpPort(port)) {
      throw refuse("smtp", `${host}:${port}`, name);
    }
    if (isRefusedLoopbackPort(port)) {
      throw refuse("loopback", `${host}:${port}`, name);
    }
    return original.apply(this, args);
  };
}

guardRequest(http, "request", "http");
guardRequest(http, "get", "http");
guardRequest(https, "request", "https");
guardRequest(https, "get", "https");

// --------------------------------------------------------------------------
// Raw sockets.
//
// Non-loopback is always refused. Loopback is bounded by data rather than by a
// blanket block, because the isolated Supabase API and database live on loopback
// TCP too: refused SMTP ports first, then — only when the caller declared an
// allowlist — every loopback port outside it. A caller that declares no
// allowlist keeps the previous behaviour of permitting loopback generally.
// --------------------------------------------------------------------------
const realSocketConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(...args) {
  let port = 0;
  let host = "";
  // `net.connect(port, host)` and `http.request(...)` both reach here having
  // already been through Node's normalizeArgs, which collapses everything into
  // a single `[options, callback]` array. Reading args[0] alone silently sees an
  // Array with no `.port` and waves the connection through.
  let first = args[0];
  if (Array.isArray(first)) first = first[0];
  if (typeof first === "number") {
    port = first;
    host = typeof args[1] === "string" ? args[1] : "";
  } else if (first && typeof first === "object") {
    port = Number(first.port);
    host = first.host || "";
  }
  if (isRefusedSmtpPort(port)) {
    throw refuse("smtp", `${host || "127.0.0.1"}:${port}`, "socket.connect");
  }
  if (port && host && !isLoopbackHost(host)) {
    throw refuse("socket", `${host}:${port}`, "socket.connect");
  }
  if (isLoopbackHost(host) && isRefusedLoopbackPort(port)) {
    throw refuse(
      "loopback-socket",
      `${host || "127.0.0.1"}:${port}`,
      "socket.connect",
    );
  }
  return realSocketConnect.apply(this, args);
};

module.exports = {
  LEDGER_PATH,
  SMTP_PORTS,
  ALLOWED_SMTP_PORTS,
  ALLOWED_LOOPBACK_PORTS,
};
