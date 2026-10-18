import assert from "node:assert/strict";
import test from "node:test";
import {
  maintenanceTarget,
  selectMaintenanceLedger,
} from "../production/maintenance-preflight.mjs";
import { reviewedDevelopmentVersions } from "../production/reconciliation-ledgers.mjs";
import {
  selectDevelopmentMaintenanceLedger,
  verifyDevelopmentMaintenance,
} from "./cutover-database.mjs";
import { controllerFixture } from "./cutover.fixture.mjs";

const target = maintenanceTarget(process.cwd());
const development = reviewedDevelopmentVersions(target);

test("Development accepts only its exact reviewed 729 history before the bound 739 target", () => {
  assert.equal(development.length, 729);
  assert.deepEqual(
    selectDevelopmentMaintenanceLedger(target, development, "before"),
    development,
  );
  assert.throws(() => selectMaintenanceLedger(target, development, "before"));
  assert.throws(() =>
    selectDevelopmentMaintenanceLedger(target, development, "target"),
  );
  assert.deepEqual(
    selectDevelopmentMaintenanceLedger(target, target, "target"),
    target,
  );
});

test("Development rejects partial, reordered, changed and differently targeted histories", () => {
  for (const observed of [
    development.slice(0, -1),
    [...development].reverse(),
    [...development.slice(0, -1), "20990101000000"],
    [...development.slice(0, -1), development[0]],
  ])
    assert.throws(() =>
      selectDevelopmentMaintenanceLedger(target, observed, "before"),
    );
  assert.throws(() =>
    selectDevelopmentMaintenanceLedger(
      [...target.slice(0, -1), "20990101000000"],
      development,
      "before",
    ),
  );
});

test("the accepted Development history still runs full maintenance catalog and posture checks", () => {
  const f = controllerFixture("prepare");
  let maintenanceSql;
  const result = verifyDevelopmentMaintenance(
    { ...f.config, cwd: process.cwd() },
    "before",
    (_url, sql) => {
      if (sql.includes("json_agg(version::text"))
        return JSON.stringify(development);
      maintenanceSql = sql;
      return "maintenance-preflight-verified";
    },
  );
  assert.equal(result.count, 729);
  assert.match(
    maintenanceSql,
    /^BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;/u,
  );
  assert.match(maintenanceSql, /FROM cron.job WHERE active/u);
  assert.match(maintenanceSql, /maintenance_write_block=on/u);
  assert.match(maintenanceSql, /publication_notification_deliveries/u);
  assert.throws(
    () =>
      verifyDevelopmentMaintenance(
        { ...f.config, cwd: process.cwd() },
        "before",
        (_url, sql) =>
          sql.includes("json_agg(version::text")
            ? JSON.stringify(development)
            : "invalid",
      ),
    /posture is not verified/u,
  );
});
