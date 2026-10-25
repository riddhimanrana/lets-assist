import assert from "node:assert/strict";
import test from "node:test";
import { developmentQuery } from "./cutover-database.mjs";
import { environment } from "./cutover.fixture.mjs";

const url = environment("inspect").DEVELOPMENT_DATABASE_URL;
const sql = "BEGIN READ ONLY; SELECT 1; COMMIT;";

test("Development diagnostics preserve the existing database transport", () => {
  assert.equal(
    developmentQuery(url, sql, (file, args, options) => {
      assert.equal(file, "psql");
      assert.deepEqual(args, ["-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"]);
      assert.equal(options.input, sql);
      assert.equal(options.env.PGHOST, new URL(url).hostname);
      assert.equal(options.env.PGDATABASE, "postgres");
      assert.equal(options.env.PGCONNECT_TIMEOUT, "15");
      assert.equal(options.timeout, 150_000);
      assert.deepEqual(options.stdio, ["pipe", "pipe", "pipe"]);
      assert.equal(args.join(" ").includes(url), false);
      return "1\n";
    }),
    "1",
  );
});

for (const [stderr, category] of [
  [
    "connection to server failed: Network is unreachable",
    "network unreachable",
  ],
  ["could not translate host name", "name resolution"],
  ["connection to server timed out", "connection timeout"],
  ["Connection refused", "connection refused"],
  ["FATAL: password authentication failed", "authentication"],
  [Buffer.from("SASL authentication failed"), "authentication"],
  ["SSL error: certificate verify failed", "TLS connection"],
  ["ERROR: permission denied for schema", "SQL permission"],
  [
    "ERROR: cannot execute UPDATE in a read-only transaction",
    "read-only rejection",
  ],
  ["ERROR: canceling statement due to statement timeout", "query timeout"],
])
  test(`Development reports only the fixed ${category} category`, () => {
    assert.throws(
      () =>
        developmentQuery(url, sql, () => {
          throw Object.assign(new Error(`${url} PRIVATE ROW VALUE`), {
            stderr:
              typeof stderr === "string"
                ? `${stderr} ${url} FICTIONAL-SECRET PRIVATE ROW VALUE`
                : Buffer.from(
                    `${stderr} ${url} FICTIONAL-SECRET PRIVATE ROW VALUE`,
                  ),
          });
        }),
      (error) => {
        assert.equal(
          error.message,
          `Development database operation failed (${category}). Raw output was suppressed.`,
        );
        assert.doesNotMatch(
          JSON.stringify(error),
          /FICTIONAL-SECRET|PRIVATE ROW|postgres:/u,
        );
        return true;
      },
    );
  });

for (const [code, category] of [
  ["ETIMEDOUT", "client timeout"],
  ["ENOENT", "database client execution"],
  ["EACCES", "database client execution"],
])
  test(`Development reports only the fixed category for client ${code}`, () => {
    assert.throws(
      () =>
        developmentQuery(url, sql, () => {
          throw Object.assign(new Error(`${url} PRIVATE ROW VALUE`), { code });
        }),
      (error) =>
        error.message ===
        `Development database operation failed (${category}). Raw output was suppressed.`,
    );
  });

test("unrecognized failures and invalid URLs retain the existing generic refusal", () => {
  let executions = 0;
  for (const connection of [url, "invalid URL PRIVATE ROW VALUE"])
    assert.throws(
      () =>
        developmentQuery(connection, sql, () => {
          executions++;
          throw Object.assign(new Error(url), {
            stderr: `${url} FICTIONAL-SECRET PRIVATE ROW VALUE`,
          });
        }),
      (error) =>
        error.message ===
        "Development database operation failed. Raw output was suppressed.",
    );
  assert.equal(executions, 1);
});
