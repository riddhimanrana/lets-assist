import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  maintenanceDataChecks,
  maintenanceMutationLockQuery,
} from "./maintenance-preflight-checks.mjs";

const available = ["initdb", "pg_ctl", "psql"].every(
  (binary) =>
    spawnSync(binary, ["--version"], { stdio: "ignore" }).status === 0,
);
const readonlyLock = maintenanceDataChecks.find(
  ({ name }) => name === "e6_pass",
).query;

test(
  "migration lock guard admits only readers blocked solely by its own DDL",
  { skip: !available, timeout: 60_000 },
  async () => {
    // This fixture owns a Unix-socket-only cluster with no application data.
    const root = mkdtempSync(join(tmpdir(), "mlock-"));
    const data = join(root, "d");
    const args = [
      "-X",
      "-h",
      root,
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
    ];
    let started = false;
    const sessions = [];
    const execute = (sql) => {
      const result = spawnSync("psql", args, {
        input: sql,
        encoding: "utf8",
        timeout: 5_000,
      });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    const session = () => {
      const child = spawn("psql", args, { stdio: ["pipe", "pipe", "pipe"] });
      sessions.push(child);
      let output = "";
      let errors = "";
      let sequence = 0;
      child.stderr.on("data", (chunk) => {
        errors += chunk;
      });
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      const query = async (sql) => {
        const marker = `finished_${++sequence}`;
        const offset = output.length;
        child.stdin.write(`${sql}\n\\echo ${marker}\n`);
        const deadline = Date.now() + 5_000;
        while (!output.slice(offset).includes(marker)) {
          assert.equal(child.exitCode, null, errors);
          assert.ok(Date.now() < deadline, `session timed out: ${errors}`);
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return output.slice(offset).split(marker)[0].trim();
      };
      return { child, query };
    };
    const waitForLock = async (pid) => {
      const deadline = Date.now() + 5_000;
      while (
        execute(
          `SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid=${pid} AND NOT granted);`,
        ) !== "t"
      ) {
        assert.ok(Date.now() < deadline, "waiter never requested its lock");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    };
    try {
      assert.equal(
        spawnSync(
          "initdb",
          ["-D", data, "-A", "trust", "-U", "postgres", "--no-sync"],
          { stdio: "ignore", timeout: 30_000 },
        ).status,
        0,
      );
      assert.equal(
        spawnSync(
          "pg_ctl",
          [
            "-D",
            data,
            "-o",
            `-k ${root} -c listen_addresses=''`,
            "-w",
            "start",
          ],
          { stdio: "ignore", timeout: 30_000 },
        ).status,
        0,
      );
      started = true;
      execute(
        "CREATE TABLE migration_target(id integer); CREATE TABLE unrelated_target(id integer);",
      );

      // Exercise nulls and blocker sets using the actual guard expression.
      const synthetic = maintenanceMutationLockQuery
        .replace("FROM pg_locks AS waiting", "FROM fixture AS waiting")
        .replaceAll("pg_backend_pid()", "101")
        .replace("pg_blocking_pids(waiting.pid)", "waiting.blockers");
      for (const [locktype, mode, pid, blockers, expected] of [
        ["'relation'", "'AccessShareLock'", "102", "ARRAY[101]", "t"],
        ["'relation'", "'AccessShareLock'", "102", "ARRAY[999]", "f"],
        ["'relation'", "'AccessShareLock'", "102", "ARRAY[101,999]", "f"],
        ["'relation'", "'AccessShareLock'", "102", "ARRAY[]::int[]", "f"],
        ["'relation'", "'AccessShareLock'", "102", "NULL::int[]", "f"],
        ["'relation'", "'AccessShareLock'", "NULL::int", "ARRAY[101]", "f"],
        ["'relation'", "'AccessShareLock'", "101", "ARRAY[101]", "f"],
        ["'relation'", "'RowExclusiveLock'", "102", "ARRAY[101]", "f"],
        ["'relation'", "'AccessExclusiveLock'", "102", "ARRAY[101]", "f"],
        ["'transactionid'", "'AccessShareLock'", "102", "ARRAY[101]", "f"],
        ["NULL::text", "'AccessShareLock'", "102", "ARRAY[101]", "f"],
        ["'relation'", "NULL::text", "102", "ARRAY[101]", "f"],
      ]) {
        assert.equal(
          execute(
            `WITH fixture(locktype,mode,pid,blockers,granted) AS (VALUES (${locktype},${mode},${pid},${blockers},false)) ${synthetic};`,
          ),
          expected,
        );
      }

      const migration = session();
      const waiter = session();
      const waiterPid = Number(await waiter.query("SELECT pg_backend_pid();"));
      assert.ok(waiterPid > 0);
      await migration.query(
        "BEGIN; LOCK TABLE migration_target IN ACCESS EXCLUSIVE MODE;",
      );
      const reading = waiter.query("SELECT count(*) FROM migration_target;");
      await waitForLock(waiterPid);
      assert.equal(
        await migration.query(`${maintenanceMutationLockQuery};`),
        "t",
      );
      assert.equal(await migration.query(`${readonlyLock};`), "f");
      assert.equal(execute(`BEGIN READ ONLY; ${readonlyLock}; COMMIT;`), "f");
      await migration.query("ROLLBACK;");
      assert.equal(await reading, "0");

      await migration.query(
        "BEGIN; LOCK TABLE migration_target IN ACCESS EXCLUSIVE MODE;",
      );
      const writing = waiter.query("INSERT INTO migration_target VALUES (1);");
      await waitForLock(waiterPid);
      assert.equal(
        await migration.query(`${maintenanceMutationLockQuery};`),
        "f",
      );
      await migration.query("ROLLBACK;");
      await writing;

      const unrelated = session();
      await unrelated.query(
        "BEGIN; LOCK TABLE unrelated_target IN ACCESS EXCLUSIVE MODE;",
      );
      const unrelatedReading = waiter.query(
        "SELECT count(*) FROM unrelated_target;",
      );
      await waitForLock(waiterPid);
      assert.equal(
        await migration.query(`${maintenanceMutationLockQuery};`),
        "f",
      );
      await unrelated.query("ROLLBACK;");
      assert.equal(await unrelatedReading, "0");
      assert.equal(
        await migration.query(`${maintenanceMutationLockQuery};`),
        "t",
      );
      assert.equal(execute(`BEGIN READ ONLY; ${readonlyLock}; COMMIT;`), "t");
    } finally {
      for (const child of sessions) child.kill("SIGTERM");
      if (started)
        spawnSync("pg_ctl", ["-D", data, "-w", "-m", "immediate", "stop"], {
          stdio: "ignore",
          timeout: 10_000,
        });
      rmSync(root, { recursive: true, force: true });
    }
  },
);
