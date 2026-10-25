import assert from "node:assert/strict";
import test from "node:test";
import {
  developmentDatabaseTransport,
  developmentQuery,
} from "./cutover-database.mjs";
import { controllerFixture, environment } from "./cutover.fixture.mjs";
import { runDevelopmentCutover } from "./development-cutover.mjs";

const direct = environment("inspect").DEVELOPMENT_DATABASE_URL;

test("the fixed Development direct endpoint selects the reviewed Session route", () => {
  for (const port of ["", "5432", "6543"])
    for (const sslmode of [null, "require", "verify-ca", "verify-full"]) {
      const original = new URL(direct);
      original.port = port;
      original.password = "fictional%40%3A%2F%3F%23%25password";
      if (sslmode) original.searchParams.set("sslmode", sslmode);
      const before = original.href;
      const selected = new URL(developmentDatabaseTransport(before));
      assert.equal(selected.hostname, "aws-0-us-west-1.pooler.supabase.com");
      assert.equal(selected.port, "5432");
      assert.equal(selected.username, "postgres.ocbuygudvarsuxijxhau");
      assert.equal(selected.password, original.password);
      assert.equal(selected.pathname, "/postgres");
      assert.equal(selected.search, original.search);
      assert.equal(original.href, before);
      let calls = 0;
      developmentQuery(
        selected.href,
        "BEGIN READ ONLY; SELECT 1; ROLLBACK;",
        (file, args, options) => {
          calls++;
          assert.equal(file, "psql");
          assert.equal(options.env.PGHOST, selected.hostname);
          assert.equal(options.env.PGPORT, "5432");
          assert.equal(options.env.PGUSER, selected.username);
          assert.equal(
            options.env.PGPASSWORD,
            decodeURIComponent(original.password),
          );
          assert.equal(options.env.PGSSLMODE, sslmode ?? "require");
          assert.equal("PGHOSTADDR" in options.env, false);
          assert.equal(
            args.some((arg) => arg.includes("fictional")),
            false,
          );
          return "1";
        },
      );
      assert.equal(calls, 1);
    }
});

test("an existing valid pooler connection is preserved byte for byte", () => {
  for (const port of ["5432", "6543"]) {
    const url = new URL(direct);
    url.hostname = "aws-0-us-west-1.pooler.supabase.com";
    url.username = "postgres.ocbuygudvarsuxijxhau";
    url.port = port;
    url.searchParams.set("sslmode", "verify-full");
    assert.equal(developmentDatabaseTransport(url.href), url.href);
  }
});

test("routing cannot authorize Production, another database, role, host or libpq override", () => {
  const invalid = [
    direct.replace("ocbuygudvarsuxijxhau", "fotdmeakexgrkronxlof"),
    direct.replace("/postgres", "/template1"),
    direct.replace("//postgres:", "//reader:"),
    direct.replace(".supabase.co", ".supabase.co.attacker.invalid"),
    direct.replace(".supabase.co", ".pooler.supabase.com"),
    "invalid-url-fictional-secret",
    ...[
      "host=x",
      "hostaddr=127.0.0.1",
      "user=postgres",
      "dbname=other",
      "options=x",
      "service=x",
      "sslmode=disable",
      "sslmode=require&sslmode=disable",
    ].map((query) => `${direct}?${query}`),
    `${direct}#fragment`,
  ];
  for (const value of invalid)
    assert.throws(
      () => developmentDatabaseTransport(value),
      (error) => {
        assert.doesNotMatch(
          error.message,
          /test-password|fictional-secret|postgres:\/\//u,
        );
        return true;
      },
    );
});

test("a failed query is not replayed and no connection credential enters a receipt", async () => {
  const f = controllerFixture("inspect");
  const original = f.config.databaseUrl;
  let calls = 0;
  await assert.rejects(
    runDevelopmentCutover(f.config, {
      ...f.dependencies,
      query: (url) => {
        calls++;
        assert.equal(
          new URL(url).hostname,
          "aws-0-us-west-1.pooler.supabase.com",
        );
        throw new Error("fictional-private-database-failure");
      },
    }),
  );
  assert.equal(calls, 1);
  assert.equal(f.config.databaseUrl, original);
  assert.deepEqual(f.state.writes, []);
  assert.equal(f.state.records.at(-1).phase, "inspection-stopped");
  assert.doesNotMatch(
    JSON.stringify(f.state.records),
    /test-password|postgres:\/\/|fictional-private/u,
  );
});
