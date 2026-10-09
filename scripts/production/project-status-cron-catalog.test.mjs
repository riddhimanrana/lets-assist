import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { bootstrapCronPauseSql } from "../hosted-development/cutover-cron.mjs";
import { expectedVersions } from "./app-release-checks.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { maintenanceCatalogQuery } from "./maintenance-preflight.mjs";
import { migrationDigests } from "./migration-digests.mjs";
import { projectStatusCronCatalog } from "./project-status-cron-catalog.mjs";
import { bootstrapPlan } from "./request-fence-bootstrap-plan.mjs";

const cwd = new URL("../../", import.meta.url).pathname;
const name = "20261009090000_schedule_project_status_maintenance.sql";
const sql = readFileSync(
  new URL(`../../supabase/migrations/${name}`, import.meta.url),
  "utf8",
);
const versions = expectedVersions(cwd).filter(
  (version) => version <= "20261009090000",
);

test("status maintenance acceptance keeps the 721 catalog and pins the job", () => {
  assert.equal(versions.length, 722);
  assert.equal(versions.at(-1), "20261009090000");
  const previous = acceptedCatalogQuery("", versions.slice(0, -1));
  const query = acceptedCatalogQuery("", versions);
  assert.equal(query, projectStatusCronCatalog(previous));
  assert.ok(query.includes(previous.trim().replace(/;$/u, "")));
  assert.match(query, /jobname = 'process-project-statuses'/u);
  assert.match(query, /schedule = '\*\/5 \* \* \* \*'/u);
  assert.match(query, /command = 'SELECT public\.process_projects\(\)'/u);
  assert.match(query, /username = 'postgres'/u);
  assert.match(query, /AS csf_target_schema_verified;$/u);
});

test("the migration schedules exactly the accepted job and replays without a duplicate", () => {
  assert.ok(
    sql.includes(
      "SELECT cron.schedule('process-project-statuses', '*/5 * * * *', 'SELECT public.process_projects()');",
    ),
  );
  assert.equal(sql.split("cron.schedule(").length, 2);
  assert.ok(
    sql.indexOf("cron.unschedule(jobname)") < sql.indexOf("cron.schedule("),
  );
  assert.match(
    sql,
    /cron\.unschedule\(jobname\) FROM cron\.job WHERE jobname = 'process-project-statuses'/u,
  );
});

test("a maintenance hold stays quiescent and the catalog accepts a paused job", () => {
  // Maintenance verifies that no cron job is active after migrations apply.
  assert.match(
    sql,
    /IF NOT EXISTS \(SELECT 1 FROM cron\.job WHERE active AND jobname <> 'process-project-statuses'\) THEN\s+PERFORM cron\.alter_job\(jobid, active := false\) FROM cron\.job WHERE jobname = 'process-project-statuses';/u,
  );
  assert.ok(sql.indexOf("cron.alter_job(") > sql.indexOf("cron.schedule("));
  assert.doesNotMatch(projectStatusCronCatalog("SELECT 1;"), /active/u);
  assert.doesNotThrow(() => maintenanceCatalogQuery(versions));
});

test("the 687 bootstrap predates the job, so its three-job inventory is unchanged", () => {
  const plan = bootstrapPlan(cwd);
  assert.ok(!plan.after.includes("20261009090000"));
  const pause = bootstrapCronPauseSql(plan.after);
  assert.match(pause, /\(SELECT count\(\*\) FROM cron\.job\) <> 3/u);
  assert.doesNotMatch(pause, /process-project-statuses/u);
});

test("status maintenance acceptance binds the migration bytes and refuses another ledger", () => {
  assert.equal(
    migrationDigests[name],
    createHash("sha256").update(sql).digest("hex"),
  );
  assert.throws(
    () =>
      acceptedCatalogQuery("", [...versions.slice(0, -1), "20261009090001"]),
    /explicit release review/u,
  );
});
