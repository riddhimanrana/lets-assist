#!/usr/bin/env node

import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import {
  buildSyntheticAccounts,
  FIXTURE_MARKER,
  FIXTURE_ORGANIZATION_HANDLE,
  fixtureOrganizationPath,
} from "./csf-load-fixture.mjs";
import { createHostedReadMetrics } from "./csf-load-metrics.mjs";

const DEVELOPMENT_REF = "ocbuygudvarsuxijxhau";
const DEVELOPMENT_URL = `https://${DEVELOPMENT_REF}.supabase.co`;
const MARKER = "\nCSF_ROUTE_METRIC=";
const ROUTES = [
  { index: 2, tab: "csf-cohorts", marker: "csf-cohort-hub-classes" },
  { index: 1, tab: "csf-applications", marker: "Split for review" },
];

export function validateDiagnosticTarget(env) {
  if (
    env.SUPABASE_URL !== DEVELOPMENT_URL ||
    env.CSF_ROUTE_DIAGNOSTIC_CONFIRMATION !== `diagnose:${DEVELOPMENT_REF}` ||
    !/^[a-f0-9]{40}$/u.test(env.CSF_ROUTE_DIAGNOSTIC_SHA ?? "")
  )
    throw new Error("Diagnostic target or confirmation is invalid.");
  return env.CSF_ROUTE_DIAGNOSTIC_SHA;
}

export function validateDiagnosticIdentity(user, expected) {
  if (
    user?.id !== expected.authUserId ||
    user?.email !== expected.email ||
    user?.app_metadata?.csf_hosted_load_fixture !== true ||
    user?.app_metadata?.organization_handle !== FIXTURE_ORGANIZATION_HANDLE ||
    user?.app_metadata?.fixture_contract !== FIXTURE_MARKER ||
    user?.app_metadata?.fixture_role !== "officer"
  )
    throw new Error(
      "Diagnostic identity is not the existing fictional officer.",
    );
}

export function parseDiagnosticResponse(output) {
  const split = output.lastIndexOf(MARKER);
  if (split < 0) throw new Error("Diagnostic response has no timing receipt.");
  const [status, firstByte, total] = output
    .slice(split + MARKER.length)
    .trim()
    .split(" ")
    .map(Number);
  if (
    status !== 200 ||
    !Number.isFinite(firstByte) ||
    firstByte < 0 ||
    !Number.isFinite(total) ||
    total < firstByte
  )
    throw new Error("Diagnostic request failed or returned invalid timing.");
  return {
    body: output.slice(0, split),
    status,
    firstByteMs: firstByte * 1000,
    durationMs: total * 1000,
  };
}

export function passesDiagnosticBudgets(rows) {
  return (
    rows.length === 2 &&
    new Set(rows.map((row) => row.route)).size === 2 &&
    rows.every(
      (row) =>
        row.role === "officer" &&
        ["classes", "applications"].includes(row.route) &&
        row.requests === 10 &&
        Number.isFinite(row.p95Ms) &&
        row.p95Ms >= 0 &&
        row.p95Ms <= 2500 &&
        Number.isFinite(row.p99Ms) &&
        row.p99Ms >= row.p95Ms &&
        row.p99Ms <= 5000 &&
        Object.keys(row.outcomes).length === 1 &&
        row.outcomes.http_200 === 10,
    )
  );
}

export async function runDiagnosticRequests(concurrency, request, observe) {
  if (![1, 5, 10].includes(concurrency))
    throw new Error("Diagnostic concurrency must be 1, 5, or 10.");
  const run = async (cycle, route) => {
    const response = await request(
      fixtureOrganizationPath(`?tab=${route.tab}`),
    );
    if (
      !response.body.includes("CSF hosted load fixture") ||
      !response.body.includes(route.marker)
    )
      throw new Error(
        "Diagnostic response did not render the intended fictional route.",
      );
    observe(cycle, route.index, response);
  };
  for (const route of ROUTES) await run(0, route);
  const pending = Array.from({ length: 10 }, (_, index) =>
    ROUTES.map((route) => ({ cycle: index + 1, route })),
  ).flat();
  let next = 0;
  let failure = null;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (!failure && next < pending.length) {
        const { cycle, route } = pending[next++];
        try {
          await run(cycle, route);
        } catch (error) {
          failure = error;
        }
      }
    }),
  );
  if (failure) throw failure;
}

function requestRoute(path, cookie = "") {
  if (
    path !== "/api/status?deep=0" &&
    !ROUTES.some(({ tab }) => path === fixtureOrganizationPath(`?tab=${tab}`))
  ) {
    throw new Error("Diagnostic path is not allowed.");
  }
  return new Promise((resolve, reject) => {
    const child = spawn(
      "vercel",
      [
        "curl",
        path,
        "--deployment",
        "https://dev.lets-assist.com",
        "--scope",
        "lets-assist-team",
        "--",
        "--silent",
        "--max-time",
        "15",
        "--config",
        "-",
        "--write-out",
        `${MARKER}%{http_code} %{time_starttransfer} %{time_total}`,
      ],
      { stdio: ["pipe", "pipe", "ignore"] },
    );
    let output = "";
    let exceeded = false;
    const timer = setTimeout(() => child.kill(), 25_000);
    child.stdout.on("data", (chunk) => {
      if (output.length + chunk.length > 8_000_000) {
        exceeded = true;
        child.kill();
      } else output += chunk;
    });
    child.on("error", () => {
      clearTimeout(timer);
      reject(new Error("Diagnostic transport could not start."));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 || exceeded)
        return reject(new Error("Diagnostic transport failed."));
      try {
        resolve(parseDiagnosticResponse(output));
      } catch {
        reject(new Error("Diagnostic response was not accepted."));
      }
    });
    child.stdin.on("error", () => {});
    // Pass the session through stdin, never process arguments or a file.
    child.stdin.end(
      cookie ? `header = ${JSON.stringify(`Cookie: ${cookie}`)}\n` : "",
    );
  });
}

async function main() {
  const sha = validateDiagnosticTarget(process.env);
  const concurrency = Number(
    process.env.CSF_ROUTE_DIAGNOSTIC_CONCURRENCY ?? "1",
  );
  if (![1, 5, 10].includes(concurrency))
    throw new Error("Diagnostic concurrency must be 1, 5, or 10.");
  const status = JSON.parse((await requestRoute("/api/status?deep=0")).body);
  if (
    status.environment !== "preview" ||
    status.version !== sha ||
    status.service !== "lets-assist"
  ) {
    throw new Error("The hosted diagnostic release does not match.");
  }
  const secret =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const publicKey =
    process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!secret || !publicKey)
    throw new Error("Development diagnostic credentials are unavailable.");
  const admin = createClient(DEVELOPMENT_URL, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const account = buildSyntheticAccounts().officers[0];
  const existing = await admin.auth.admin.getUserById(account.authUserId);
  if (existing.error) throw new Error("The fictional officer is unavailable.");
  validateDiagnosticIdentity(existing.data.user, account);
  const link = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: account.email,
  });
  if (link.error || !link.data.properties?.hashed_token)
    throw new Error("A diagnostic login could not be generated.");
  validateDiagnosticIdentity(link.data.user, account);
  const cookies = new Map();
  const client = createServerClient(DEVELOPMENT_URL, publicKey, {
    cookies: {
      getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
      setAll: (values) =>
        values.forEach(({ name, value }) =>
          value ? cookies.set(name, value) : cookies.delete(name),
        ),
    },
  });
  const login = await client.auth.verifyOtp({
    type: "email",
    token_hash: link.data.properties.hashed_token,
  });
  if (login.error || !login.data.session)
    throw new Error("Diagnostic login failed.");
  try {
    validateDiagnosticIdentity(login.data.user, account);
    if (!cookies.size)
      throw new Error("Diagnostic session cookies are missing.");
    const cookie = [...cookies]
      .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
      .join("; ");
    const metrics = createHostedReadMetrics();
    await runDiagnosticRequests(
      concurrency,
      (path) => requestRoute(path, cookie),
      (cycle, routeIndex, response) => {
        if (cycle > 0)
          metrics.record({
            role: "officer",
            routeIndex,
            durationMs: response.durationMs,
            status: response.status,
          });
        console.log(
          JSON.stringify({
            cycle,
            route: routeIndex === 2 ? "classes" : "applications",
            warmup: cycle === 0,
            firstByteMs: response.firstByteMs,
            durationMs: response.durationMs,
          }),
        );
      },
    );
    const rows = metrics.summarize();
    const passed = passesDiagnosticBudgets(rows);
    console.log(
      JSON.stringify({
        kind: "single-session-diagnostic-not-load-acceptance",
        sha,
        concurrency,
        rows,
        passed,
      }),
    );
    if (!passed) process.exitCode = 1;
  } finally {
    const result = await client.auth.signOut({ scope: "local" });
    cookies.clear();
    if (result.error) {
      console.error("Diagnostic session cleanup was not confirmed.");
      process.exitCode = 1;
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(() => {
    console.error(
      "CSF route diagnostic stopped. No response bodies or credentials were retained.",
    );
    process.exitCode = 1;
  });
}
