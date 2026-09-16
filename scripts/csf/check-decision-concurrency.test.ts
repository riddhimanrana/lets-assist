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
    expect(source).toContain("await_advisory_wait");
    // The shell must not time a race. `sleep 0.05` inside a polling loop is a
    // poll interval, not a race, so only whole-second shell sleeps are banned.
    expect(source).not.toMatch(/^\s*sleep [1-9][0-9]*\s*$/m);
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
    // Both savers are backgrounded and both are awaited in a named wait state
    // before either is allowed to proceed.
    expect(source).toContain("csf_mapping_saver_");
    expect(source).toMatch(/SAVER_PIDS\[saver_index\]=\$!/);
    expect(source).toContain("both mapping saves are inside the function");
  });

  test("fixture identifiers are minted per run", () => {
    expect(source).toContain("crypto.randomUUID()");
    expect(source).toContain("RUN_SUFFIX");
  });
});
