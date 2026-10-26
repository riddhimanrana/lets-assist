import assert from "node:assert/strict";
import test from "node:test";
import { setApplicationWriteBlock } from "./set-application-write-block.mjs";
import {
  applicationRequestWriteFlagSql,
  settlePreexistingRequestTransactionsSql,
} from "./request-write-fence.mjs";
import { productionRef } from "./app-release-checks.mjs";

const env = {
  SUPABASE_ACCESS_TOKEN: "synthetic-token",
  SUPABASE_DB_PASSWORD: "synthetic-password",
  PRODUCTION_BOOTSTRAP_DATABASE_URL:
    "postgresql://ignored/ignored?sslmode=verify-full",
};
const primary = {
  database_type: "PRIMARY",
  db_host: "aws-0-synthetic.pooler.supabase.com",
  db_user: `postgres.${productionRef}`,
  db_name: "postgres",
  db_port: 6543,
  pool_mode: "transaction",
};

test("every fixed write-block operation uses unchanged SQL on the shared session transport", async () => {
  for (const mode of ["enable", "disable", "barrier"]) {
    let calls = 0;
    await setApplicationWriteBlock(mode, env, {
      fetcher: async () => ({ status: 200, json: async () => [primary] }),
      execute: (cmd, args, options) => {
        calls++;
        assert.equal(cmd, "psql");
        assert.deepEqual(args, [
          "-X",
          "-q",
          "-t",
          "-A",
          "-v",
          "ON_ERROR_STOP=1",
        ]);
        assert.equal(
          options.input,
          mode === "barrier"
            ? settlePreexistingRequestTransactionsSql
            : applicationRequestWriteFlagSql(mode === "enable"),
        );
        assert.equal(options.env.PGPORT, "5432");
        assert.equal(options.env.PGSSLMODE, "verify-full");
        assert.equal(options.timeout, 45_000);
        return "";
      },
    });
    assert.equal(calls, 1);
  }
});

test("write-block metadata failures refuse before SQL and suppress provider errors", async () => {
  let calls = 0;
  for (const mode of ["enable", "disable", "barrier", "arbitrary-sql"]) {
    await assert.rejects(
      setApplicationWriteBlock(mode, env, {
        fetcher: async () => {
          throw new Error("private-provider-sentinel");
        },
        execute: () => {
          calls++;
        },
      }),
      (error) => !error.message.includes("private-provider-sentinel"),
    );
  }
  assert.equal(calls, 0);
});
