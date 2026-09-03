#!/usr/bin/env node

import { fileURLToPath } from "node:url";

const PRODUCTION_SUPABASE_HOSTS = new Set([
  "api.lets-assist.com",
  "fotdmeakexgrkronxlof.supabase.co",
]);

function normalizeHostname(value) {
  return value.trim().toLowerCase().replace(/\.+$/u, "");
}

function parseExpectedNonProductionHost(env, vercelEnvironment) {
  const expectedHostValue = env.EXPECTED_NON_PRODUCTION_SUPABASE_HOST;
  const expectedHost = expectedHostValue
    ? normalizeHostname(expectedHostValue)
    : undefined;
  const expectedProjectRef =
    env.EXPECTED_NON_PRODUCTION_SUPABASE_PROJECT_REF?.trim().toLowerCase();
  const hostFromRef = expectedProjectRef
    ? `${expectedProjectRef}.supabase.co`
    : undefined;

  if (!expectedHost && !hostFromRef) {
    throw new Error(
      `Refusing ${vercelEnvironment} deployment without an exact expected non-production Supabase host or project ref.`,
    );
  }

  if (expectedProjectRef && !/^[a-z0-9]{20}$/u.test(expectedProjectRef)) {
    throw new Error(
      `Refusing ${vercelEnvironment} deployment with an invalid expected Supabase project ref.`,
    );
  }

  if (expectedHost && !/^[a-z0-9.-]+$/u.test(expectedHost)) {
    throw new Error(
      `Refusing ${vercelEnvironment} deployment with an invalid expected Supabase host.`,
    );
  }

  if (expectedHost && hostFromRef && expectedHost !== hostFromRef) {
    throw new Error(
      `Refusing ${vercelEnvironment} deployment because its expected Supabase host and project ref disagree.`,
    );
  }

  const resolvedHost = expectedHost ?? hostFromRef;
  if (PRODUCTION_SUPABASE_HOSTS.has(resolvedHost)) {
    throw new Error(
      `Refusing ${vercelEnvironment} deployment because the expected Supabase host is production.`,
    );
  }

  return resolvedHost;
}

/**
 * Prevent Preview, Development, and custom Vercel environments from using the
 * production database. Local builds do not set VERCEL_ENV and are unaffected.
 *
 * @param {Record<string, string | undefined>} [env]
 */
export function assertDeploymentEnvironmentIsolation(env = process.env) {
  const vercelEnvironment = env.VERCEL_ENV?.trim().toLowerCase();

  if (!vercelEnvironment) {
    return;
  }

  if (vercelEnvironment === "production") {
    const configuredUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    if (!configuredUrl) {
      throw new Error(
        "Refusing production deployment without NEXT_PUBLIC_SUPABASE_URL.",
      );
    }

    let configuredUrlObject;
    try {
      configuredUrlObject = new URL(configuredUrl);
    } catch {
      throw new Error(
        "Refusing production deployment with an invalid NEXT_PUBLIC_SUPABASE_URL.",
      );
    }

    const hostname = normalizeHostname(configuredUrlObject.hostname);
    if (configuredUrlObject.protocol !== "https:") {
      throw new Error(
        "Refusing production deployment without an HTTPS Supabase URL.",
      );
    }
    if (!PRODUCTION_SUPABASE_HOSTS.has(hostname)) {
      throw new Error(
        `Refusing production deployment configured for unapproved Supabase host ${hostname}.`,
      );
    }
    return;
  }

  const expectedHost = parseExpectedNonProductionHost(env, vercelEnvironment);

  const configuredUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!configuredUrl) {
    throw new Error(
      `Refusing ${vercelEnvironment} deployment without NEXT_PUBLIC_SUPABASE_URL.`,
    );
  }

  let configuredUrlObject;
  try {
    configuredUrlObject = new URL(configuredUrl);
  } catch {
    throw new Error(
      `Refusing ${vercelEnvironment} deployment with an invalid NEXT_PUBLIC_SUPABASE_URL.`,
    );
  }

  // A fully qualified DNS name may end in a dot. Canonicalize it before the
  // production denylist and exact expected-host comparison so a trailing dot
  // cannot turn the same production endpoint into a different string.
  const hostname = normalizeHostname(configuredUrlObject.hostname);

  if (configuredUrlObject.protocol !== "https:") {
    throw new Error(
      `Refusing ${vercelEnvironment} deployment without an HTTPS Supabase URL.`,
    );
  }

  if (PRODUCTION_SUPABASE_HOSTS.has(hostname)) {
    throw new Error(
      `Refusing ${vercelEnvironment} deployment configured for the production Supabase host ${hostname}.`,
    );
  }

  if (hostname !== expectedHost) {
    throw new Error(
      `Refusing ${vercelEnvironment} deployment configured for unexpected Supabase host ${hostname}; expected ${expectedHost}.`,
    );
  }
}

const isEntrypoint = process.argv[1]
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (isEntrypoint) {
  assertDeploymentEnvironmentIsolation();
}
