import { createClient } from "@supabase/supabase-js";

import {
  getCsfIsolatedSupabaseEnv,
  inspectCsfIsolatedWorkDir,
} from "./local-dev/dv-local-env.mjs";

/**
 * Drain the CSF publication notification queue against the selected isolated
 * stack, and print the run report.
 *
 * The browser suite cannot reach `/api/cron/csf-publication-notifications`: the
 * isolated app runner generates its own cron secret inside the child process
 * and never hands it back, deliberately, so that a browser run cannot drive a
 * worker by holding a token. This is the same out-of-band shape
 * `test-csf-post-email-dispatch.ts` already uses for the mail worker: the real
 * worker function, the real database, a separate process.
 *
 * This runs the notice worker only. It creates in-app notifications and hands
 * personal notices to the communications ledger; it cannot send mail, so a
 * campaign it queues stays queued until the mail worker is run separately.
 */

const workDir = process.env.CSF_ISOLATED_WORK_DIR?.trim();
if (!workDir) {
  throw new Error("CSF_ISOLATED_WORK_DIR is required.");
}

const isolated = inspectCsfIsolatedWorkDir(workDir);
const local = getCsfIsolatedSupabaseEnv();

// Both the notification insert and the campaign hand-off construct their client
// from these, so they are set before the worker module is imported.
process.env.NEXT_PUBLIC_SUPABASE_URL = local.url;
process.env.SUPABASE_SECRET_KEY = local.serviceRoleKey;
// Link origin for the notice body. Loopback only; the notice links back to the
// app this stack is running, never to a hosted environment.
process.env.NEXT_PUBLIC_SITE_URL = `http://127.0.0.1:${isolated.basePort}`;

// `server-only` throws unless the react-server condition is set, and this
// script deliberately does not set it: see the note above the import below.
// Neutralising it here is the same thing the Next.js server build does for a
// route handler, which is the runtime this worker actually runs in.
Bun.plugin({
  name: "csf-notice-worker-server-only",
  setup(build) {
    build.module("server-only", () => ({ exports: {}, loader: "object" }));
  },
});

/**
 * Imported after the plugin above is registered, and deliberately WITHOUT
 * `--conditions=react-server`.
 *
 * The hand-off renders the notice email with @react-email/render, which needs
 * `react-dom/server`. React refuses that module under the react-server
 * condition: "react-dom/server is not supported in React Server Components."
 * Running this script with that condition therefore made every hand-off throw,
 * the worker recorded it as an unconfirmed enqueue, and the delivery went back
 * to the queue with a growing backoff having sent nothing.
 *
 * The product is not affected. In the app this worker runs from a route
 * handler, where Next.js resolves `react-dom/server` normally, which is why the
 * broadcast path renders the same way and delivers. The condition was copied
 * from the mail dispatch script, which never renders anything.
 */
const { runCsfPublicationNotificationWorker } =
  await import("../lib/plugins/private/plugins/dvhs-csf/services/publication-notifications");

const plugin = createClient(local.url, local.serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  db: { schema: "plugin_data" },
});

type WorkerOptions = NonNullable<
  Parameters<typeof runCsfPublicationNotificationWorker>[0]
>;

const report = await runCsfPublicationNotificationWorker({
  plugin: plugin as unknown as WorkerOptions["plugin"],
});

process.stdout.write(`${JSON.stringify(report)}\n`);
