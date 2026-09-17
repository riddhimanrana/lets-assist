import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { inspectCsfIsolatedWorkDir } from "../local-dev/dv-local-env.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const dbUrl = process.env.SUPABASE_DB_URL;
const workDir = process.env.CSF_ISOLATED_WORK_DIR;
if (!dbUrl || !workDir)
  throw new Error("An owned isolated CSF stack is required.");
const target = new URL(dbUrl);
const isolated = inspectCsfIsolatedWorkDir(workDir);
if (
  target.protocol !== "postgresql:" ||
  !["127.0.0.1", "localhost"].includes(target.hostname) ||
  target.username !== "postgres" ||
  target.pathname !== "/postgres" ||
  Number(target.port) !== isolated.databasePort
)
  throw new Error("The backfill test accepts only loopback Supabase Postgres.");

const migration = readFileSync(
  `${root}supabase/migrations/20260918120000_csf_retired_join_code_backfill.sql`,
  "utf8",
);
if (
  !/^--[^\n]*\n--[^\n]*\nBEGIN;\n/u.test(migration) ||
  !/\nCOMMIT;\s*$/u.test(migration)
)
  throw new Error("The reviewed backfill transaction shape changed.");
const body = migration
  .replace(/^([\s\S]*?\n)BEGIN;\n/u, "$1")
  .replace(/\nCOMMIT;\s*$/u, "");
const fixtureTemplate = readFileSync(
  `${root}scripts/production/fixtures/retired-join-code.sql`,
  "utf8",
);
if (fixtureTemplate.split("__RETENTION_ACTOR__").length !== 3)
  throw new Error("The synthetic retirement fixture changed.");
const fixture = (actor) =>
  fixtureTemplate.replaceAll("__RETENTION_ACTOR__", actor);
const check = `DO $assert$
BEGIN
  IF (SELECT status FROM plugin_data.csf_class_join_codes
      WHERE id = 'bb210000-0000-4000-8000-000000000001') <> 'revoked'
    OR (SELECT revoked_by FROM plugin_data.csf_class_join_codes
      WHERE id = 'bb210000-0000-4000-8000-000000000001')
      IS DISTINCT FROM 'bb000000-0000-4000-8000-000000000001'::uuid
    OR (SELECT count(*) FROM plugin_data.csf_admin_audit_events
      WHERE target_id = 'bb210000-0000-4000-8000-000000000001'
        AND action = 'class.join_code.revoked'
        AND source_id = 'bb220000-0000-4000-8000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'Retired code was not revoked exactly once with its actor and audit.';
  END IF;
END;
$assert$;`;

function psql(sql) {
  return spawnSync("psql", [dbUrl, "-X", "-q", "-v", "ON_ERROR_STOP=1"], {
    input: sql,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 1_000_000,
  });
}

const success = psql(
  `BEGIN;\n${fixture("'bb000000-0000-4000-8000-000000000001'")}\n${body}\n${check}\n${body}\n${check}\nROLLBACK;`,
);
if (success.status !== 0)
  throw new Error(
    `Retired-code backfill replay failed: ${success.stderr.trim()}`,
  );

const actorless = psql(`BEGIN;\n${fixture("NULL")}\n${body}\nROLLBACK;`);
if (
  actorless.status === 0 ||
  !actorless.stderr.includes(
    "A retired CSF class has an active code without a retention actor.",
  )
)
  throw new Error("The actorless retirement must abort the backfill.");

console.log(
  "Retired-code backfill replay passed: audited once, repeat-safe, actorless abort.",
);
