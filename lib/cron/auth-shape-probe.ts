import "server-only";

import { createRequire } from "node:module";
import { join } from "node:path";
import { NextResponse } from "next/server";

/**
 * One shared, server-only, env-gated auth/shape probe for the operational cron
 * routes.
 *
 * The problem it solves: the local cron smoke check used to prove "the cron
 * routes are wired" by enabling the workers and sending authenticated
 * operational POSTs, then treating an empty queue as evidence that nothing
 * happened. An empty queue is a property of the data, not of the code, so that
 * check would have dispatched real work the moment the fixtures grew a row.
 *
 * This probe replaces that with a claim the harness can actually prove: the
 * route authenticated the caller and would have reached its dispatch boundary,
 * and it returned before touching a worker-enable flag, a Supabase client, a
 * query, a processor, Storage, email, OAuth, or any provider.
 *
 * It is deliberately hard to turn on:
 *
 *   - the exact env value `CRON_AUTH_SHAPE_PROBE_ONLY=auth-shape-v1`, and
 *   - a validated CSF isolated runtime identity (marker + loopback endpoints),
 *
 * and it never relaxes a route's real authentication. A caller without a valid
 * bearer token still takes the route's existing 401 path, because every route
 * calls this helper strictly *after* its own authorization check.
 */

export const CRON_AUTH_SHAPE_PROBE_ENV = "CRON_AUTH_SHAPE_PROBE_ONLY";
export const CRON_AUTH_SHAPE_PROBE_MODE = "auth-shape-v1";
export const CRON_AUTH_SHAPE_PROBE_HEADER = "x-lets-assist-cron-probe";

/**
 * Stable route IDs. These are part of the probe's wire contract: the harness
 * asserts that the ID it asked for is the ID that answered, so a copy-pasted
 * handler that probes under a neighbour's name is a visible failure rather than
 * a silent pass.
 */
export const CRON_PROBE_ROUTE_IDS = [
  "auto-publish-hours",
  "project-cancellations",
  "organization-calendar-sync",
  "organization-sheet-sync",
  "data-exports",
  "csf-communications-dispatch",
  "csf-class-workbook-refresh",
  "csf-import-commit",
  "csf-scheduled-post-publisher",
  "project-feedback-followups",
  "paper-signup-notifications",
] as const;

export type CronProbeRouteId = (typeof CRON_PROBE_ROUTE_IDS)[number];

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

type ProbeHeaders = { get(name: string): string | null };
type IsolatedWorkDirInspector = (workDirValue?: string) => unknown;

function loadIsolatedWorkDirInspector(): IsolatedWorkDirInspector {
  // The validator belongs to the local harness and is needed only after the
  // exact probe env token is present. Keeping the path runtime-only prevents a
  // production route from making Turbopack trace the local CLI and next.config.
  const modulePath = join(
    /* turbopackIgnore: true */ process.cwd(),
    "scripts",
    "local-dev",
    "dv-local-env.mjs",
  );
  const localRequire = createRequire(import.meta.url);
  const validatorModule = Reflect.apply(localRequire, undefined, [
    modulePath,
  ]) as {
    inspectCsfIsolatedWorkDir?: IsolatedWorkDirInspector;
  };
  if (typeof validatorModule.inspectCsfIsolatedWorkDir !== "function") {
    throw new Error("CSF isolated work-directory validator is unavailable.");
  }
  return validatorModule.inspectCsfIsolatedWorkDir;
}

function isLoopbackUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    return LOOPBACK_HOSTS.has(new URL(value).hostname);
  } catch {
    return false;
  }
}

/**
 * A hosted deployment must never satisfy this, no matter what else is set.
 * These are checked before the marker so a Production process cannot be talked
 * into reading an attacker-supplied path off disk.
 */
function isHostedRuntime(env: NodeJS.ProcessEnv): boolean {
  return (
    Boolean(env.VERCEL || env.VERCEL_ENV || env.VERCEL_URL) ||
    env.NODE_ENV === "production"
  );
}

/**
 * Re-read per call rather than caching at module load: a probe that cached
 * "isolated" once would keep answering after the marker it depends on was
 * revoked, which is the opposite of fail-closed.
 *
 * The identity check itself is `inspectCsfIsolatedWorkDir` — the same strict
 * validator the launcher, the stop path, the seed script, and the redesign gate
 * use. This file used to carry its own looser copy: it parsed a subset of the
 * marker, and it never looked at the generated Supabase config at all. Two
 * validators of the same evidence is one validator too many, and the weaker one
 * decides. The shared one rejects unknown, duplicate, missing, or truncated
 * marker fields; wrong mode or owner UID; hardlinked marker/config files;
 * project or port drift between marker and config; a re-enabled Google identity
 * provider in the generated config; database-volume label drift; and bytes that
 * change between validation and handoff.
 */
function hasValidatedIsolatedRuntime(env: NodeJS.ProcessEnv): boolean {
  try {
    if (isHostedRuntime(env)) return false;

    loadIsolatedWorkDirInspector()(env.CSF_ISOLATED_WORK_DIR);

    // A validated local marker next to a hosted Supabase URL is still not an
    // isolated runtime, so the endpoint checks stay here rather than moving into
    // the file validator.
    if (!isLoopbackUrl(env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL)) {
      return false;
    }
    if (!isLoopbackUrl(env.NEXT_PUBLIC_SITE_URL ?? env.SITE_URL)) return false;

    return true;
  } catch {
    return false;
  }
}

function probeResponse(route: CronProbeRouteId) {
  return NextResponse.json({
    ok: true,
    route,
    mode: CRON_AUTH_SHAPE_PROBE_MODE,
    dispatched: false,
  });
}

function probeRequiredResponse(route: CronProbeRouteId) {
  return NextResponse.json(
    {
      ok: false,
      route,
      mode: CRON_AUTH_SHAPE_PROBE_MODE,
      error: "cron_probe_required",
      dispatched: false,
    },
    { status: 428 },
  );
}

function isolationInvalidResponse(route: CronProbeRouteId) {
  return NextResponse.json(
    {
      ok: false,
      route,
      mode: CRON_AUTH_SHAPE_PROBE_MODE,
      error: "cron_probe_isolation_invalid",
      dispatched: false,
    },
    { status: 503 },
  );
}

/**
 * Call this immediately after a cron route's own authorization check and before
 * anything that can dispatch work.
 *
 * Probe mode is detected first, before any filesystem work at all: a normal
 * production request returns `null` without the strict work-directory validator
 * ever being reached.
 *
 * @returns `null` when probe mode is not requested, in which case the route's
 * normal behavior is byte-for-byte unchanged. Otherwise a terminal response the
 * caller must return without dispatching.
 */
export function cronAuthShapeProbe(
  route: CronProbeRouteId,
  request: { headers: ProbeHeaders },
  env: NodeJS.ProcessEnv = process.env,
): NextResponse | null {
  const requested = env[CRON_AUTH_SHAPE_PROBE_ENV];

  // Unset or empty is the only "not requested" state. A non-empty value that is
  // not the exact token is a misconfigured probe request, and a misconfigured
  // probe request must not fall through to real dispatch — that silent
  // fallthrough is exactly the defect this wave exists to remove.
  if (requested === undefined || requested === "") return null;
  if (requested !== CRON_AUTH_SHAPE_PROBE_MODE) {
    return isolationInvalidResponse(route);
  }

  if (!hasValidatedIsolatedRuntime(env)) {
    return isolationInvalidResponse(route);
  }

  if (
    request.headers.get(CRON_AUTH_SHAPE_PROBE_HEADER) !==
    CRON_AUTH_SHAPE_PROBE_MODE
  ) {
    return probeRequiredResponse(route);
  }

  return probeResponse(route);
}
