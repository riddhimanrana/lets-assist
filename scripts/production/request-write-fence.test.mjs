import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  applicationRequestWriteFenceBodySha256,
  applicationRequestWriteFenceQuery,
  requireApplicationRequestWriteFenceSql,
} from "./request-write-fence.mjs";

test("guard verification binds the published function body and exact execution boundary", () => {
  const migration = readFileSync(
    new URL(
      "../../supabase/migrations/20260929051600_application_request_write_fence.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const body = migration.match(
    /SET search_path = ''\nAS \$\$([\s\S]*?)\$\$;/u,
  )?.[1];
  assert.ok(body);
  assert.equal(
    createHash("sha256").update(body).digest("hex"),
    applicationRequestWriteFenceBodySha256,
  );
  for (const required of [
    "routine.pronargs = 0",
    "routine.prokind = 'f'",
    "routine.prorettype = 'pg_catalog.void'::regtype",
    "NOT routine.proretset",
    "NOT routine.prosecdef",
    "NOT routine.proleakproof",
    "routine.provolatile = 's'",
    "routine.proparallel = 'u'",
    "routine.proowner = 'postgres'::regrole",
    "language.lanname = 'plpgsql'",
    "routine.proconfig = ARRAY['search_path=\"\"']::text[]",
    "pg_catalog.aclexplode(routine.proacl)) = 4",
    "permission.grantor <> 'postgres'::regrole",
    "permission.privilege_type <> 'EXECUTE' OR permission.is_grantable",
    "configured.setrole IN (0, 'authenticator'::regrole)",
    "configured.setdatabase <> 0 OR configured.setrole <> 'authenticator'::regrole",
  ])
    assert.ok(applicationRequestWriteFenceQuery.includes(required), required);
  assert.ok(requireApplicationRequestWriteFenceSql.includes("IF NOT (SELECT"));
  assert.ok(
    requireApplicationRequestWriteFenceSql.includes("USING ERRCODE = '55000'"),
  );
});

test("Production flag changes require hook verification before writing and fresh API proof afterward", () => {
  const directory = mkdtempSync(join(tmpdir(), "write-fence-shell-"));
  try {
    const stub = join(directory, "supabase");
    writeFileSync(
      stub,
      '#!/bin/sh\nprintf "%s\\n" "$4" >> "$WRITE_FENCE_CAPTURE"\nif [ "$WRITE_FENCE_REFUSE" = "1" ]; then exit 1; fi\n',
    );
    chmodSync(stub, 0o700);
    const timeoutStub = join(directory, "timeout");
    writeFileSync(
      timeoutStub,
      '#!/bin/sh\n[ "$1" = "60s" ] || exit 1\nshift\nexec "$@"\n',
    );
    chmodSync(timeoutStub, 0o700);
    // The stub records SQL only. It cannot contact a database or provider.
    for (const mode of ["enable", "disable"]) {
      const capture = join(directory, `${mode}.sql`);
      const env = {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        SUPABASE_ACCESS_TOKEN: "synthetic",
        SUPABASE_DB_PASSWORD: "synthetic",
        WRITE_FENCE_CAPTURE: capture,
      };
      const script = new URL(
        "./set-application-write-block.sh",
        import.meta.url,
      ).pathname;
      const output = execFileSync("bash", [script, mode], {
        env,
        encoding: "utf8",
      });
      const sql = readFileSync(capture, "utf8");
      assert.ok(
        sql.startsWith(`BEGIN; ${requireApplicationRequestWriteFenceSql}`),
      );
      assert.ok(
        sql.includes(
          mode === "enable"
            ? "SET default_transaction_read_only TO 'on'; COMMIT;"
            : "RESET default_transaction_read_only; COMMIT;",
        ),
      );
      assert.ok(output.includes("Fresh API verification is required."));
      writeFileSync(capture, "");
      assert.throws(() =>
        execFileSync("bash", [script, mode], {
          env: { ...env, WRITE_FENCE_REFUSE: "1" },
          stdio: "pipe",
        }),
      );
      const refused = readFileSync(capture, "utf8");
      assert.equal((refused.match(/BEGIN;/gu) ?? []).length, 1);
      assert.ok(!refused.includes("captured_pids"));
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
