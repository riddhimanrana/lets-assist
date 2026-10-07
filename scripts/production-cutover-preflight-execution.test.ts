import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "..");
const preflight = readFileSync(
  join(repositoryRoot, "scripts/production-cutover-preflight.sql"),
  "utf8",
);
const HARD_FAIL_STATEMENT = "SELECT 1 / 0 AS preflight_check_failed;";
const hardFailStatements =
  preflight.match(/^[ \t]*SELECT 1 \/ 0 AS preflight_check_failed;$/gmu) ?? [];

function binaryAvailable(binary: string) {
  return spawnSync(binary, ["--version"], { stdio: "ignore" }).status === 0;
}

const localPostgresAvailable = ["initdb", "pg_ctl", "psql"].every(
  binaryAvailable,
);

function fixtureScript(checkPasses: boolean, failureCommand: string) {
  return `${[
    "\\set ON_ERROR_STOP on",
    "BEGIN TRANSACTION READ ONLY;",
    `SELECT ${checkPasses} AS check_pass`,
    "\\gset",
    "\\if :check_pass",
    "  \\echo 'PASS FIXTURE'",
    "\\else",
    "  \\echo 'FAIL FIXTURE'",
    `  ${failureCommand}`,
    "\\endif",
    "ROLLBACK;",
  ].join("\n")}\n`;
}

function withDisposableCluster(
  assertions: (runFixture: (script: string) => number) => void,
) {
  // The cluster lives in a temporary directory and listens on a unix socket
  // only, so it can never reach or be reached by a hosted database.
  const root = mkdtempSync(join(tmpdir(), "pf-"));
  const dataDirectory = join(root, "d");
  let started = false;
  try {
    const initialized = spawnSync(
      "initdb",
      ["-D", dataDirectory, "-A", "trust", "-U", "postgres", "--no-sync"],
      { stdio: "ignore" },
    );
    if (initialized.status !== 0) {
      throw new Error(
        "initdb could not create the disposable preflight cluster",
      );
    }
    const start = spawnSync(
      "pg_ctl",
      [
        "-D",
        dataDirectory,
        "-o",
        `-k ${root} -c listen_addresses=''`,
        "-w",
        "start",
      ],
      { stdio: "ignore" },
    );
    if (start.status !== 0) {
      throw new Error(
        "pg_ctl could not start the disposable preflight cluster",
      );
    }
    started = true;
    assertions((script) => {
      const scriptPath = join(root, "fixture.sql");
      writeFileSync(scriptPath, script);
      return (
        spawnSync(
          "psql",
          [
            "-X",
            "-h",
            root,
            "-U",
            "postgres",
            "-d",
            "postgres",
            "-f",
            scriptPath,
          ],
          { stdio: "ignore" },
        ).status ?? -1
      );
    });
  } finally {
    if (started) {
      spawnSync(
        "pg_ctl",
        ["-D", dataDirectory, "-w", "-m", "immediate", "stop"],
        {
          stdio: "ignore",
        },
      );
    }
    rmSync(root, { recursive: true, force: true });
  }
}

// Executing the full Production preflight needs a Production-shaped ledger, so
// these tests run the identical hard-fail construct inside the same
// ON_ERROR_STOP / \if guard shape against a throwaway local cluster.
describe.skipIf(!localPostgresAvailable)(
  "Production cutover preflight failure branches abort psql",
  () => {
    test("a FAIL branch exits non-zero, a PASS control path still exits zero, and \\quit 3 would not have failed", () => {
      const [firstHardFail] = hardFailStatements;
      const hardFail = (firstHardFail ?? "").trim();
      expect(hardFail).toBe(HARD_FAIL_STATEMENT);

      withDisposableCluster((runFixture) => {
        expect(runFixture(fixtureScript(false, hardFail))).toBe(3);
        expect(runFixture(fixtureScript(true, hardFail))).toBe(0);
        expect(runFixture(fixtureScript(false, "\\quit 3"))).toBe(0);
      });
    }, 120_000);

    test("the CSF catalog queries parse and execute read-only", () => {
      const s0 = preflight.slice(
        preflight.indexOf("S0  CSF relation inventory"),
        preflight.indexOf("S1  plugin_data RLS and browser isolation"),
      );
      const baselineShapeStart = s0.indexOf("WITH required_columns");
      const baselineShapeQuery = s0
        .slice(baselineShapeStart, s0.indexOf("\\gset", baselineShapeStart))
        .replaceAll(":'baseline_ledger'::boolean", "false");
      const targetCsf = preflight.slice(
        preflight.indexOf("T2C 444 CSF release-tail contract"),
        preflight.indexOf("T3  Target pg_graphql posture"),
      );
      const catalogQuery = targetCsf.slice(
        targetCsf.indexOf("WITH expected_tables"),
        targetCsf.indexOf("  \\gset"),
      );
      expect(baselineShapeQuery).toContain("csf_column_shape_ready");
      expect(catalogQuery).toContain("target_csf_release_tail_pass");

      withDisposableCluster((runFixture) => {
        const script = [
          "\\set ON_ERROR_STOP on",
          "CREATE ROLE anon;",
          "CREATE ROLE authenticated;",
          "CREATE ROLE service_role;",
          "CREATE SCHEMA plugin_data;",
          "BEGIN TRANSACTION READ ONLY;",
          `${baselineShapeQuery};`,
          `${catalogQuery};`,
          "ROLLBACK;",
        ].join("\n");
        expect(runFixture(`${script}\n`)).toBe(0);
      });
    }, 120_000);

    test("T5 accepts reviewed definers and refuses extra callers or changed security posture", () => {
      const acl = preflight.slice(
        preflight.indexOf("T5  Public read-model and function ACL posture"),
        preflight.indexOf("T6  Exact target relation ACL"),
      );
      const queryStart = acl.indexOf("WITH expected(signature, role_name)");
      const query = acl.slice(queryStart, acl.indexOf("\\gset", queryStart));
      const definerBlock = acl.slice(
        acl.indexOf("reviewed_security_definer(signature"),
        acl.indexOf("actual AS ("),
      );
      const definers = new Set(
        [...definerBlock.matchAll(/'(public\.[^']+)'/gu)].map(
          (match) => match[1],
        ),
      );
      const grants = [
        ...acl.matchAll(/\('([^']+\([^']*\))',\s*'(anon|authenticated)'\)/gu),
      ].map((match) => [match[1], match[2]]);
      const functions = [...new Set(grants.map(([signature]) => signature))];
      const setup = [
        "\\set ON_ERROR_STOP on",
        "CREATE ROLE anon; CREATE ROLE authenticated;",
        ...functions.flatMap((signature) => [
          `CREATE FUNCTION ${signature} RETURNS boolean LANGUAGE sql SECURITY ${definers.has(signature) ? "DEFINER" : "INVOKER"} AS $$SELECT true$$;`,
          `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`,
        ]),
        ...grants.map(
          ([signature, role]) =>
            `GRANT EXECUTE ON FUNCTION ${signature} TO ${role};`,
        ),
      ].join("\n");
      const check = (change = "") =>
        [
          "\\set ON_ERROR_STOP on",
          change ? "BEGIN;" : "BEGIN READ ONLY;",
          change,
          query,
          "\\gset",
          "\\if :target_function_acl_pass",
          "\\else",
          HARD_FAIL_STATEMENT,
          "\\endif",
          "ROLLBACK;",
        ].join("\n");

      withDisposableCluster((runFixture) => {
        expect(runFixture(`${setup}\n`)).toBe(0);
        expect(runFixture(check())).toBe(0);
        expect(
          runFixture(
            check(
              "GRANT EXECUTE ON FUNCTION public.account_deletion_pending() TO anon;",
            ),
          ),
        ).toBe(3);
        expect(
          runFixture(
            check(
              "ALTER FUNCTION public.account_deletion_pending() SECURITY INVOKER;",
            ),
          ),
        ).toBe(3);
        expect(
          runFixture(
            check(
              "CREATE FUNCTION public.unreviewed_definer() RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$SELECT true$$; REVOKE ALL ON FUNCTION public.unreviewed_definer() FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.unreviewed_definer() TO authenticated;",
            ),
          ),
        ).toBe(3);
        expect(runFixture(check())).toBe(0);
      });
    }, 120_000);
  },
);
