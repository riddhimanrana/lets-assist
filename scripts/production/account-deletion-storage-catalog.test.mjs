import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { accountDeletionStorageCatalog } from "./account-deletion-storage-catalog.mjs";

const available = ["initdb", "pg_ctl", "psql"].every(
  (binary) =>
    spawnSync(binary, ["--version"], { stdio: "ignore" }).status === 0,
);

test(
  "account-removal Storage catalog checks fail closed on trigger drift",
  {
    skip: !available,
    timeout: 120_000,
  },
  () => {
    // A separate unix-socket-only cluster avoids the shared and isolated app DBs.
    const root = mkdtempSync(join(tmpdir(), "ads-"));
    const data = join(root, "d");
    let started = false;
    const execute = (sql) => {
      const result = spawnSync(
        "psql",
        [
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
        ],
        { input: sql, encoding: "utf8", timeout: 10_000 },
      );
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
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
      execute(`CREATE SCHEMA storage; CREATE SCHEMA app_private;
      CREATE TABLE storage.objects(id integer);
      CREATE FUNCTION app_private.guard_account_deletion_write() RETURNS trigger
        LANGUAGE plpgsql AS $$BEGIN RETURN NULL; END$$;
      CREATE FUNCTION app_private.account_deletion_storage_fence() RETURNS trigger
        LANGUAGE plpgsql AS $$BEGIN RETURN NEW; END$$;
      CREATE FUNCTION app_private.unreviewed_fence() RETURNS trigger
        LANGUAGE plpgsql AS $$BEGIN RETURN NEW; END$$;
      CREATE TRIGGER account_deletion_write_fence BEFORE INSERT OR UPDATE OR DELETE
        ON storage.objects FOR EACH STATEMENT EXECUTE FUNCTION app_private.guard_account_deletion_write();
      CREATE TRIGGER account_deletion_storage_reference_fence BEFORE INSERT OR UPDATE
        ON storage.objects FOR EACH ROW EXECUTE FUNCTION app_private.account_deletion_storage_fence();`);
      const catalog = accountDeletionStorageCatalog("SELECT 1;");
      assert.equal(execute(`BEGIN READ ONLY; ${catalog} ROLLBACK;`), "1");
      assert.equal(execute(accountDeletionStorageCatalog("SELECT 0;")), "0");
      for (const name of [
        "account_deletion_write_fence",
        "account_deletion_storage_reference_fence",
      ]) {
        const statement = name === "account_deletion_write_fence";
        const events = statement
          ? "INSERT OR DELETE OR UPDATE"
          : "INSERT OR UPDATE";
        const level = statement ? "STATEMENT" : "ROW";
        const signature = statement
          ? "app_private.guard_account_deletion_write()"
          : "app_private.account_deletion_storage_fence()";
        for (const action of [
          `ALTER TABLE storage.objects DISABLE TRIGGER ${name};`,
          `ALTER TABLE storage.objects ENABLE ALWAYS TRIGGER ${name};`,
          `DROP TRIGGER ${name} ON storage.objects;`,
          `DROP TRIGGER ${name} ON storage.objects;
         CREATE TRIGGER ${name} BEFORE ${events} ON storage.objects
         FOR EACH ${level} EXECUTE FUNCTION app_private.unreviewed_fence();`,
          `DROP TRIGGER ${name} ON storage.objects;
         CREATE TRIGGER ${name} BEFORE INSERT ON storage.objects
         FOR EACH ${level} EXECUTE FUNCTION ${signature};`,
          `DROP TRIGGER ${name} ON storage.objects;
         CREATE TRIGGER ${name} AFTER ${events} ON storage.objects
         FOR EACH ${level} EXECUTE FUNCTION ${signature};`,
          `DROP TRIGGER ${name} ON storage.objects;
         CREATE TRIGGER ${name} BEFORE ${events} ON storage.objects
         FOR EACH ${statement ? "ROW" : "STATEMENT"} EXECUTE FUNCTION ${signature};`,
          `DROP TRIGGER ${name} ON storage.objects;
         CREATE TRIGGER ${name} BEFORE ${events} ON storage.objects
         FOR EACH ${level} WHEN (false) EXECUTE FUNCTION ${signature};`,
        ]) {
          assert.equal(
            execute(`BEGIN; ${action} ${catalog} ROLLBACK;`),
            "0",
            action,
          );
        }
      }
      assert.equal(
        execute(`BEGIN; DROP SCHEMA storage CASCADE; ${catalog} ROLLBACK;`),
        "0",
      );
      assert.equal(execute(`BEGIN READ ONLY; ${catalog} ROLLBACK;`), "1");
    } finally {
      if (started)
        spawnSync("pg_ctl", ["-D", data, "-w", "-m", "immediate", "stop"], {
          stdio: "ignore",
          timeout: 30_000,
        });
      rmSync(root, { recursive: true, force: true });
    }
  },
);
