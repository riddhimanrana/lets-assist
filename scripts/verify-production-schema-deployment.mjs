#!/usr/bin/env node

import { fileURLToPath } from "node:url";

export const COMMITTED_PRODUCTION_SUPABASE_REF = "fotdmeakexgrkronxlof";
export const REQUIRED_PRODUCTION_CONFIRMATION = `deploy-production:${COMMITTED_PRODUCTION_SUPABASE_REF}`;

/**
 * Production schema mutation is manual-only and pinned to the committed project
 * reference. Branch pushes may run validation, but may never satisfy this gate.
 *
 * @param {Record<string, string | undefined>} [env]
 */
export function assertProductionSchemaDeploymentAuthorization(
  env = process.env,
) {
  if (env.GITHUB_EVENT_NAME !== "workflow_dispatch") {
    throw new Error("Production schema deployment requires workflow_dispatch.");
  }
  if (env.GITHUB_REF !== "refs/heads/main") {
    throw new Error("Production schema deployment requires refs/heads/main.");
  }
  if (env.PRODUCTION_DEPLOY_CONFIRMATION !== REQUIRED_PRODUCTION_CONFIRMATION) {
    throw new Error(
      `Production schema deployment requires the exact confirmation ${REQUIRED_PRODUCTION_CONFIRMATION}.`,
    );
  }
  if (env.SUPABASE_PROJECT_ID !== COMMITTED_PRODUCTION_SUPABASE_REF) {
    throw new Error(
      "Configured production Supabase project ref does not match the committed ref.",
    );
  }
  if (
    env.LINKED_SUPABASE_PROJECT_REF &&
    env.LINKED_SUPABASE_PROJECT_REF !== COMMITTED_PRODUCTION_SUPABASE_REF
  ) {
    throw new Error(
      "Linked Supabase project ref does not match the committed production ref.",
    );
  }
}

const isEntrypoint = process.argv[1]
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (isEntrypoint) {
  try {
    assertProductionSchemaDeploymentAuthorization();
    console.log(
      `Production schema deployment authorized for ${COMMITTED_PRODUCTION_SUPABASE_REF}.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
