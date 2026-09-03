import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import {
  getCsfIsolatedSupabaseEnv,
  inspectCsfIsolatedWorkDir,
} from "./local-dev/dv-local-env.mjs";
import {
  runCsfDispatchWorker,
  type CsfPluginRpc,
} from "../services/csf-communications-worker";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const organizationId = process.argv[2] ?? "";
if (!UUID.test(organizationId)) {
  throw new Error("Pass one synthetic isolated organization id.");
}

const workDir = process.env.CSF_ISOLATED_WORK_DIR?.trim();
if (!workDir) {
  throw new Error("CSF_ISOLATED_WORK_DIR is required.");
}

const isolated = inspectCsfIsolatedWorkDir(workDir);
const local = getCsfIsolatedSupabaseEnv();
process.env.EMAIL_TRANSPORT = "mailpit";
process.env.EMAIL_FROM = "Let's Assist Local <noreply@lets-assist.local>";
process.env.MAILPIT_HOST = "127.0.0.1";
process.env.MAILPIT_SMTP_PORT = String(isolated.smtpPort);

const plugin = createClient(local.url, local.serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  db: { schema: "plugin_data" },
}) as unknown as CsfPluginRpc;

let claimed = 0;
let sent = 0;
let faults = 0;
for (let pass = 0; pass < 20; pass += 1) {
  const report = await runCsfDispatchWorker(plugin, {
    organizationId,
    workerId: `csf-browser-mailpit-${randomUUID()}`,
    correlationId: randomUUID(),
    batchSize: 25,
  });
  claimed += report.claimed;
  sent += report.attempts.filter((attempt) => attempt.status === "sent").length;
  faults += report.attempts.filter(
    (attempt) => attempt.status !== "sent" && attempt.status !== "refused",
  ).length;
  if (report.claimed === 0) break;
}

process.stdout.write(`${JSON.stringify({ claimed, sent, faults })}\n`);
