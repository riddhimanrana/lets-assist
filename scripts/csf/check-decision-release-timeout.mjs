import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import { getCsfIsolatedSupabaseEnv } from "../local-dev/dv-local-env.mjs";

// This validator refuses hosted/shared databases before opening a connection.
// Synthetic immutable receipts stay in the disposable launcher-owned stack.
const env = getCsfIsolatedSupabaseEnv();
const runId = randomBytes(6).toString("hex");
const fid = (name) => {
  const hex = createHash("md5")
    .update(runId + name)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
};
const sql = (query) => {
  const result = spawnSync(
    "psql",
    ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-d", env.dbUrl],
    {
      input: query,
      encoding: "utf8",
      env: { ...process.env, PGDATABASE: env.dbUrl },
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  if (result.status !== 0) throw new Error(result.stderr || "Local SQL failed");
  return result.stdout.trim();
};
const name = "csf_release_reviewed_sheet_decisions";
const baseline = `csf_test_timeout_${runId}`;
const pause = `csf_test_pause_${runId}`;
const literal = (value) => `'${value.replaceAll("'", "''")}'`;
const originalTimeout =
  sql(`SELECT setting FROM pg_roles, LATERAL unnest(rolconfig) setting
WHERE rolname='service_role' AND setting LIKE 'statement_timeout=%'`);
const readback = () =>
  JSON.parse(
    sql(`SELECT json_build_object(
  'approved', (SELECT count(*) FROM plugin_data.csf_term_applications WHERE organization_id='${fid("org")}' AND decision_status='approved'),
  'rejected', (SELECT count(*) FROM plugin_data.csf_term_applications WHERE organization_id='${fid("org")}' AND decision_status='rejected'),
  'pending', (SELECT count(*) FROM plugin_data.csf_term_applications WHERE organization_id='${fid("org")}' AND decision_status='pending'),
  'memberships', (SELECT count(*) FROM plugin_data.csf_term_memberships WHERE organization_id='${fid("org")}'),
  'releases', (SELECT count(*) FROM plugin_data.csf_application_decision_releases WHERE organization_id='${fid("org")}'),
  'exports', (SELECT count(*) FROM plugin_data.csf_sheet_writeback_ledger WHERE organization_id='${fid("org")}'),
  'notices', (SELECT count(*) FROM plugin_data.csf_publication_events WHERE organization_id='${fid("org")}' AND event_key LIKE 'application_decision:%'),
  'allNotices', (SELECT count(*) FROM plugin_data.csf_publication_events WHERE organization_id='${fid("org")}'))`),
  );
const rpc = async (functionName, body, key = env.serviceRoleKey) => {
  const started = performance.now();
  const response = await fetch(`${env.url}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "Content-Profile": "plugin_data",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(65000),
  });
  return {
    status: response.status,
    body: await response.json(),
    ms: performance.now() - started,
  };
};
try {
  const fixture = readFileSync(
    new URL("./fixtures/decision-release-timeout.sql", import.meta.url),
    "utf8",
  ).replaceAll("runidplaceholder", runId);
  const token = sql(`BEGIN;\n${fixture}\nCOMMIT;`);
  assert.match(token, /^[a-f0-9]{64}$/u);
  sql(`
    ALTER ROLE service_role SET statement_timeout='8s';
    CREATE FUNCTION plugin_data.${pause}() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
    BEGIN
      IF NEW.id='${fid("app1")}'::uuid AND NEW.decision_status IS DISTINCT FROM OLD.decision_status THEN PERFORM pg_catalog.pg_sleep(9); END IF;
      RETURN NEW;
    END $$;
    REVOKE ALL ON FUNCTION plugin_data.${pause}() FROM PUBLIC, anon, authenticated, service_role;
    CREATE TRIGGER ${pause} AFTER UPDATE ON plugin_data.csf_term_applications
      FOR EACH ROW EXECUTE FUNCTION plugin_data.${pause}();
    CREATE FUNCTION plugin_data.${baseline}(p_organization_id uuid,p_actor_user_id uuid,p_term_id uuid,p_request_id uuid,p_expected_review_token text)
      RETURNS jsonb LANGUAGE sql SET search_path='' AS $$
      SELECT plugin_data.${name}(p_organization_id,p_actor_user_id,p_term_id,p_request_id,p_expected_review_token)
      $$;
    REVOKE ALL ON FUNCTION plugin_data.${baseline}(uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
    GRANT EXECUTE ON FUNCTION plugin_data.${baseline}(uuid,uuid,uuid,uuid,text) TO service_role;
    NOTIFY pgrst,'reload config'; NOTIFY pgrst,'reload schema';
  `);
  await setTimeout(1500);
  const body = {
    p_organization_id: fid("org"),
    p_actor_user_id: fid("officer"),
    p_term_id: fid("term"),
    p_request_id: fid("release"),
    p_expected_review_token: token,
  };
  const initial = readback();
  const denied = await rpc(name, body, env.anonKey);
  assert.ok(
    [401, 403].includes(denied.status),
    "anonymous publication must be denied",
  );
  const wrongActor = await rpc(name, {
    ...body,
    p_actor_user_id: fid("unrelated-actor"),
  });
  assert.equal(
    wrongActor.body.code,
    "42501",
    "an unrelated actor cannot publish",
  );
  const stale = await rpc(name, {
    ...body,
    p_expected_review_token: "0".repeat(64),
  });
  assert.equal(
    stale.body.code,
    "23514",
    "stale reviewed release must be refused",
  );
  const timedOut = await rpc(baseline, body);
  assert.equal(
    timedOut.body.code,
    "57014",
    "the default eight-second request must time out",
  );
  assert.ok(timedOut.ms >= 7000 && timedOut.ms < 12000);
  assert.deepEqual(
    readback(),
    initial,
    "timeout rolls back all decisions, memberships, exports and notices",
  );
  const released = await rpc(name, body);
  assert.equal(released.status, 200, JSON.stringify(released.body));
  assert.equal(released.body.released, 600);
  assert.ok(released.ms > 9000 && released.ms < 60000);
  const saved = readback();
  assert.equal(saved.approved, 580);
  assert.equal(saved.rejected, 20);
  assert.equal(saved.pending, 22);
  assert.equal(saved.memberships, 580);
  assert.equal(saved.releases, 1);
  assert.equal(
    saved.notices,
    1,
    "only the connected profile gets a decision event",
  );
  assert.equal(saved.allNotices, initial.allNotices + 1);
  const replay = await rpc(name, body);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replay, true);
  assert.deepEqual(
    readback(),
    saved,
    "retry creates no duplicate credits, exports or notices",
  );
  const worker = spawnSync(
    "bun",
    ["run", "scripts/test-csf-publication-notice-worker.ts"],
    { encoding: "utf8", env: process.env, timeout: 60000 },
  );
  assert.equal(
    worker.status,
    0,
    `The real notification worker must consume the release fixture: ${worker.stderr}`,
  );
  const deliveredNotices = Number(
    sql(`SELECT count(*) FROM plugin_data.csf_publication_notification_deliveries d
      JOIN plugin_data.csf_publication_events e ON e.id=d.event_id AND e.organization_id=d.organization_id
      WHERE d.organization_id='${fid("org")}' AND d.status='delivered'
        AND e.event_key LIKE 'application_decision:%'`),
  );
  assert.equal(
    deliveredNotices,
    1,
    "the connected profile receives one notice",
  );
  console.log(
    JSON.stringify({
      success: true,
      defaultTimeoutMs: Math.round(timedOut.ms),
      releaseMs: Math.round(released.ms),
      ...saved,
      deliveredNotices,
    }),
  );
} finally {
  sql(`
    DROP TRIGGER IF EXISTS ${pause} ON plugin_data.csf_term_applications;
    DROP FUNCTION IF EXISTS plugin_data.${pause}();
    DROP FUNCTION IF EXISTS plugin_data.${baseline}(uuid,uuid,uuid,uuid,text);
    ${originalTimeout ? `ALTER ROLE service_role SET statement_timeout=${literal(originalTimeout.slice("statement_timeout=".length))};` : "ALTER ROLE service_role RESET statement_timeout;"}
    NOTIFY pgrst,'reload config'; NOTIFY pgrst,'reload schema';
  `);
}
