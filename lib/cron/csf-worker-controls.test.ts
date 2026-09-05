import { afterEach, beforeEach, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
const calls: unknown[] = [];
let result: { data: unknown; error: unknown };
let throws = false;
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    rpc: (name: string, args: unknown) => {
      calls.push({ name, args });
      return {
        abortSignal: async (signal: AbortSignal) => {
          expect(signal).toBeInstanceOf(AbortSignal);
          if (throws) throw new Error("private transport detail");
          return result;
        },
      };
    },
  }),
}));
const { readCsfWorkerControls, isCsfWorkerEnabled } =
  await import("./csf-worker-controls");
const saved = { ...process.env };
const sha = "a".repeat(40);
const flags = {
  workbook_refresh: true,
  import_commit: false,
  communications: false,
  scheduled_post_publisher: false,
};
beforeEach(() => {
  calls.length = 0;
  throws = false;
  process.env.CSF_WORKER_CONTROL_MODE = "database";
  process.env.LETS_ASSIST_BUILD_SHA = sha;
  result = {
    data: { releaseSha: sha, revision: 1, workers: { ...flags } },
    error: null,
  };
});
afterEach(() => {
  process.env = { ...saved };
});

test("reads release-bound switches on each request without caching", async () => {
  expect(await isCsfWorkerEnabled("workbook_refresh")).toBe(true);
  result = {
    data: {
      releaseSha: sha,
      revision: 2,
      workers: { ...flags, workbook_refresh: false },
    },
    error: null,
  };
  expect(await isCsfWorkerEnabled("workbook_refresh")).toBe(false);
  expect(calls).toEqual(
    Array(2).fill({
      name: "read_csf_release_worker_controls",
      args: { p_release_sha: sha },
    }),
  );
});
test("database mode ignores stale environment enable flags", async () => {
  process.env.CSF_COMMUNICATIONS_WORKER_ENABLED = "true";
  expect(await isCsfWorkerEnabled("communications")).toBe(false);
});
test("legacy environment mode does not contact the database", async () => {
  delete process.env.CSF_WORKER_CONTROL_MODE;
  process.env.CSF_IMPORT_WORKER_ENABLED = "true";
  expect(await isCsfWorkerEnabled("import_commit")).toBe(true);
  expect(calls).toEqual([]);
});
test("malformed mode cannot enable processing", async () => {
  process.env.CSF_WORKER_CONTROL_MODE = "Database";
  process.env.CSF_IMPORT_WORKER_ENABLED = "true";
  expect((await readCsfWorkerControls()).available).toBe(false);
  expect(await isCsfWorkerEnabled("import_commit")).toBe(false);
  expect(calls).toEqual([]);
});
test("missing build SHA fails closed before constructing a client", async () => {
  delete process.env.LETS_ASSIST_BUILD_SHA;
  expect((await readCsfWorkerControls()).available).toBe(false);
  expect(calls).toEqual([]);
});
test("wrong release, malformed flags, and transport errors fail closed", async () => {
  for (const data of [
    null,
    {},
    { releaseSha: "b".repeat(40), revision: 1, workers: flags },
    { releaseSha: sha, revision: -1, workers: flags },
    {
      releaseSha: sha,
      revision: 1,
      workers: { ...flags, communications: "true" },
    },
    { releaseSha: sha, revision: 1, workers: { ...flags, extra: true } },
  ]) {
    result = { data, error: null };
    expect((await readCsfWorkerControls()).available).toBe(false);
    expect(await isCsfWorkerEnabled("workbook_refresh")).toBe(false);
  }
  result = {
    data: { releaseSha: sha, revision: 1, workers: flags },
    error: { message: "private database error" },
  };
  expect((await readCsfWorkerControls()).available).toBe(false);
  throws = true;
  expect((await readCsfWorkerControls()).available).toBe(false);
});
