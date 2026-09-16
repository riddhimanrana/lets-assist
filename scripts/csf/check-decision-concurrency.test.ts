import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

/**
 * Offline guards for `check-decision-concurrency.sh`.
 *
 * The script is read-write against a database, so the property worth testing
 * without one is the refusal: a stack it does not own must produce zero database
 * calls, not a connection attempt that happens to fail.
 *
 * "Zero database calls" is measured rather than assumed. A fake `psql` is placed
 * first on PATH and appends a line every time it is invoked. An empty recorder
 * is proof; a script that regressed to connecting first and validating second
 * would still exit non-zero and would still fail here.
 *
 * The earlier version of this script accepted any `SUPABASE_DB_URL` and
 * immediately deleted a fixed organization name. These cases are the reason that
 * cannot come back quietly.
 */

const SCRIPT = resolve(import.meta.dir, "check-decision-concurrency.sh");
const REPO_ROOT = resolve(import.meta.dir, "../..");

type Attempt = {
  exitCode: number;
  stderr: string;
  psqlInvocations: string[];
};

/**
 * Run the script with a recording `psql` ahead of the real one, and with a
 * `node` that is real, because the refusal itself is implemented in node.
 */
async function runScript(
  env: Record<string, string | undefined>,
): Promise<Attempt> {
  const sandbox = mkdtempSync(join(tmpdir(), "csf-concurrency-guard-"));
  const binDir = join(sandbox, "bin");
  mkdirSync(binDir, { recursive: true });
  const recorder = join(sandbox, "psql-invocations.log");
  writeFileSync(recorder, "");

  const fakePsql = join(binDir, "psql");
  writeFileSync(
    fakePsql,
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >>${JSON.stringify(recorder)}\nexit 0\n`,
  );
  chmodSync(fakePsql, 0o755);

  const realNode = process.execPath;
  const nodeShim = join(binDir, "node");
  writeFileSync(
    nodeShim,
    `#!/usr/bin/env bash\nexec ${JSON.stringify(realNode)} "$@"\n`,
  );
  chmodSync(nodeShim, 0o755);

  const child = Bun.spawn(["bash", SCRIPT], {
    cwd: REPO_ROOT,
    env: {
      PATH: `${binDir}:${dirname(realNode)}:/usr/bin:/bin`,
      HOME: process.env.HOME ?? "",
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);

  return {
    exitCode,
    stderr,
    psqlInvocations: readFileSync(recorder, "utf8").split("\n").filter(Boolean),
  };
}

/** A marker directory that exists but is not a validated isolated stack. */
function wrongMarkerDir() {
  const dir = mkdtempSync(join(tmpdir(), "csf-wrong-marker-"));
  writeFileSync(
    join(dir, "csf-isolated-stack.json"),
    JSON.stringify({
      state: "ready",
      project_id: "not-the-project",
      run_id: "not-the-run",
      base_port: 65000,
      work_dir: dir,
      db_volume: "nope",
    }),
  );
  return dir;
}

describe("refusing a stack the script does not own", () => {
  test("a missing marker refuses before any database call", async () => {
    const attempt = await runScript({ CSF_ISOLATED_WORK_DIR: undefined });

    expect(attempt.exitCode).toBe(2);
    expect(attempt.stderr).toContain("CSF_ISOLATED_WORK_DIR");
    expect(attempt.psqlInvocations).toEqual([]);
  });

  test("a hosted database URL cannot be supplied instead of a marker", async () => {
    // The old script took SUPABASE_DB_URL on trust. Offering one now has to
    // change nothing, because the marker is what authorizes the run.
    const attempt = await runScript({
      CSF_ISOLATED_WORK_DIR: undefined,
      SUPABASE_DB_URL:
        "postgresql://postgres:secret@db.example.supabase.co:5432/postgres",
    });

    expect(attempt.exitCode).toBe(2);
    expect(attempt.psqlInvocations).toEqual([]);
  });

  test("a remote database URL alongside a real-looking marker still refuses", async () => {
    const attempt = await runScript({
      CSF_ISOLATED_WORK_DIR: wrongMarkerDir(),
      SUPABASE_DB_URL:
        "postgresql://postgres:secret@db.example.supabase.co:5432/postgres",
    });

    expect(attempt.exitCode).toBe(2);
    expect(attempt.psqlInvocations).toEqual([]);
  });

  test("a marker directory that is not a validated stack refuses", async () => {
    const attempt = await runScript({
      CSF_ISOLATED_WORK_DIR: wrongMarkerDir(),
    });

    expect(attempt.exitCode).toBe(2);
    expect(attempt.stderr).toContain("did not validate");
    expect(attempt.psqlInvocations).toEqual([]);
  });

  test("a marker path that does not exist refuses", async () => {
    const attempt = await runScript({
      CSF_ISOLATED_WORK_DIR: join(tmpdir(), "csf-absent-marker-directory"),
    });

    expect(attempt.exitCode).toBe(2);
    expect(attempt.psqlInvocations).toEqual([]);
  });

  test("an empty marker path is treated as absent, not as the repository root", async () => {
    const attempt = await runScript({ CSF_ISOLATED_WORK_DIR: "" });

    expect(attempt.exitCode).toBe(2);
    expect(attempt.stderr).toContain("CSF_ISOLATED_WORK_DIR");
    expect(attempt.psqlInvocations).toEqual([]);
  });
});

describe("the script's own shape", () => {
  const source = readFileSync(SCRIPT, "utf8");

  test("bash accepts it", async () => {
    const child = Bun.spawn(["bash", "-n", SCRIPT], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("it never deletes by organization name", () => {
    // A name is not an identity. Deleting by username took whatever fixture
    // happened to share the name, including another run's.
    expect(source).not.toMatch(
      /DELETE FROM public\.organizations WHERE username/i,
    );
    expect(source).toMatch(
      /DELETE FROM public\.organizations WHERE id = :'org_id'/,
    );
  });

  test("teardown removes the auth user it created", () => {
    expect(source).toMatch(/DELETE FROM auth\.users WHERE id = :'actor_id'/);
  });

  test("teardown failures are reported rather than suppressed", () => {
    // The old cleanup ended in `|| true`, so a failed teardown looked like a
    // clean run and left rows behind.
    expect(source).not.toMatch(/teardown\.sql[^\n]*\|\|\s*true/);
    expect(source).toContain("could not be torn down cleanly");
  });

  test("it waits on observed lock state rather than on a fixed sleep", () => {
    expect(source).toContain("pg_catalog.pg_stat_activity");
    expect(source).toContain("await_all_waiting");
    // The shell must not time a race. `sleep 0.05` inside a polling loop is a
    // poll interval, not a race, so only whole-second shell sleeps are banned.
    expect(source).not.toMatch(/^\s*sleep [1-9][0-9]*\s*$/m);
  });

  test("a group barrier is one reading, not a poll per session", () => {
    // Polling each session in turn accepts a sequential wake: the first waiter
    // finishes before the second arrives, and nothing was ever simultaneous.
    // The count has to come from a single query over the whole group.
    expect(source).toContain("SELECT count(DISTINCT application_name)");
    expect(source).toMatch(/await_all_waiting 2 "'Lock'" "'advisory'"/);
  });

  test("a second row waiter may report transactionid or tuple", () => {
    // Which queue a waiter joins decides which event it reports, and accepting
    // only one of them would make the barrier flaky rather than strict.
    expect(source).toContain("\"'transactionid', 'tuple'\"");
  });

  test("session names are run-scoped", () => {
    // Two runs against one stack must not see each other waiting and call it
    // their own barrier.
    expect(source).toContain("session_name()");
    expect(source).toMatch(/printf 'csf_%s_%s' "\$1" "\$\{RUN_SUFFIX\}"/);
    for (const name of [
      "term_lock_holder",
      "decision_sync",
      "decision_release",
      "staff_lock_holder",
      "mapping_row_holder",
    ]) {
      expect(source).toContain(`session_name ${name}`);
    }
    // No bare PGAPPNAME literal: every one goes through session_name.
    expect(source).not.toMatch(/PGAPPNAME=csf_[a-z_]+\b/);
  });

  test("a holder is released by cancelling its own backend", () => {
    // Killing the shell wrapper does not necessarily end the backend, so the
    // lock could still be held while the script believed it was free.
    expect(source).toContain("pg_catalog.pg_cancel_backend");
    expect(source).toContain("pg_catalog.pg_terminate_backend");
    expect(source).toContain("backend_pid_for");
    // And the release is verified rather than assumed.
    expect(source).toMatch(/release_holder[\s\S]*?WHERE pid = \$\{pid\}/);
    expect(source).not.toMatch(
      /kill "\$\{(HOLDER|STAFF_HOLDER|MAPPING_HOLDER)_PID\}"/,
    );
  });

  test("the sync payload carries the provenance the application records", () => {
    // `recorded_response_id` matching needs the workbook id and the response id
    // to agree with the stored application. A payload that disagrees is stored
    // unmatched, and a concurrency suite over a no-op proves nothing.
    expect(source).toContain("WORKBOOK_FILE_ID=");
    expect(source).toContain("RESPONSE_ID=");
    expect(source).toMatch(/'spreadsheetFileId', :'workbook_file_id'/);
    expect(source).toMatch(/'responseId', :'response_id'/);
    expect(source).not.toMatch(/'responseId', NULL/);
    // The application row records the same two values.
    expect(source).toMatch(
      /:'workbook_file_id', 'Form Responses 1', 5, :'response_id'/,
    );
  });

  test("it proves the sync changed something before racing it", () => {
    expect(source).toContain("changed_count");
    expect(source).toContain(
      "the sync matched the application by recorded provenance and staged it",
    );
  });

  test("the mapping version comes from the database, not a literal", () => {
    // A stale version blocks every row of the source, which would make the
    // checks measure nothing.
    expect(source).toContain("MAPPING_VERSION=");
    expect(source).toMatch(/'mappingVersion', :'mapping_version'/);
    expect(source).toMatch(/:'expected_version'::integer/);
  });

  test("mapping saves match the parser's shape, not the SQL's tolerance", () => {
    // `csf_set_application_decision_mapping` only checks that identityColumns,
    // scope, and colors are objects, so a malformed mapping is stored without
    // complaint. `parseCsfSheetDecisionMapping` is the real contract, and a
    // fixture that satisfied only the SQL would be testing against a document
    // no reader accepts.
    for (const key of [
      "'decisionColumns'",
      "'reasonColumns'",
      "'readsCellNote'",
      "'identityColumns'",
      "'scope'",
      "'colors'",
    ]) {
      expect(source).toContain(key);
    }
    // scope is the sheet coordinate, not a decision mode.
    expect(source).toContain("'sheetTabName', 'Form Responses 1'");
    expect(source).toContain("'rangeA1', 'A1:W600'");
    expect(source).toContain("'headerRow', 1");
    expect(source).not.toContain("'scope', jsonb_build_object('decision'");
    // identityColumns carries all three the parser reads.
    expect(source).toMatch(/'email', 2, 'submittedAt', 1, 'responseId', 3/);
    // colors carries explicit fill lists, including the fills that mean nothing.
    for (const fillKey of [
      "'accepted'",
      "'rejected'",
      "'rejectedWithExplanation'",
      "'ignoredFills'",
    ]) {
      expect(source).toContain(fillKey);
    }
    expect(source).not.toContain("'colors', jsonb_build_object()");
    // Both the seed and the racing savers send it, not just one of them.
    expect(source.split("'ignoredFills'").length - 1).toBe(2);
  });

  test("the fixture username varies per run", () => {
    // `left` of the flattened uuid is the discriminator plus the fixed version
    // and variant nibbles, so it was the same string on every run and the second
    // run collided on the unique username. The run suffix lives at the other end.
    expect(source).toContain(
      "right(replace(organization_id::text, '-', ''), 12)",
    );
    expect(source).not.toContain(
      "left(replace(organization_id::text, '-', ''), 12)",
    );
  });

  test("every connection is bounded", () => {
    // Including the probes and the teardown. A holder sleeps at most 120s, so
    // the statement ceiling sits above that and still ends a stuck session.
    expect(source).toMatch(/export PGOPTIONS=.*statement_timeout=180000/);
    expect(source).toMatch(/export PGOPTIONS=.*lock_timeout=150000/);
    expect(source).toMatch(
      /export PGOPTIONS=.*idle_in_transaction_session_timeout=180000/,
    );
  });

  test("holders are released even when a barrier fails and exits early", () => {
    // A failed barrier exits before the holder's own release, and a holder left
    // running would keep its lock while teardown deleted the rows underneath it.
    expect(source).toContain("HELD_SESSIONS=()");
    expect(source).toContain("release_all_holders");
    // Released before teardown, not after it.
    expect(source).toMatch(
      /on_exit\(\) \{\n {2}local exit_code=\$\?\n {2}release_all_holders/,
    );
    for (const holder of ["TERM_HOLDER", "STAFF_HOLDER", "MAPPING_HOLDER"]) {
      expect(source).toContain(`HELD_SESSIONS+=("\${${holder}}`);
    }
  });

  test("the race is a meaningful correction, not two no-ops", () => {
    expect(source).toContain("stage_sql rejected '#f4cccc'");
    expect(source).toContain(
      "the race converged on rejected with exactly one receipt",
    );
    // Only a state a serial order could have produced is accepted.
    expect(source).toContain("serially_valid");
  });

  test("minted identifiers are checked as UUIDs before any insert", () => {
    // The first group is eight characters. An earlier revision emitted seven,
    // which the column type rejects mid-run rather than at the door.
    expect(source).toContain("printf 'fc%s00000-0000-4000-8000-%s'");
    expect(source).toContain("minted identifier is not a UUID");
  });

  test("output carries no decorative symbols", () => {
    // The repository writing guide asks for plain text.
    expect(source).not.toMatch(/[\u2500-\u257F\u2580-\u259F]/);
    expect(source).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });

  test("it drives the real sync and release functions", () => {
    expect(source).toContain(
      "plugin_data.csf_stage_sheet_application_decisions(",
    );
    expect(source).toContain(
      "plugin_data.csf_release_sheet_application_decisions(",
    );
  });

  test("the mapping saves run concurrently rather than in sequence", () => {
    // An earlier revision ran them in a `for` loop, so the second simply read
    // the version the first had written. Both are backgrounded now, and both
    // are awaited in one reading before either is allowed to proceed.
    expect(source).toContain("session_name mapping_saver_one");
    expect(source).toContain("session_name mapping_saver_two");
    expect(source).toMatch(/SAVER_PIDS\+=\("\$!"\)/);
    expect(source).toContain("both mapping saves are inside the function");
  });

  test("fixture identifiers are minted per run", () => {
    expect(source).toContain("crypto.randomUUID()");
    expect(source).toContain("RUN_SUFFIX");
  });
});
