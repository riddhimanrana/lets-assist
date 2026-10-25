import assert from "node:assert/strict";
import test from "node:test";
import {
  candidateHistoryMarginMs,
  candidateHistoryStart,
  refuseEarlierStage,
} from "./cutover-vercel.mjs";
import { runDevelopmentCutover } from "./development-cutover.mjs";
import { candidate, clock, controllerFixture } from "./cutover.fixture.mjs";

const day = 86_400_000;
const run = (createdAt, sha = candidate) => ({
  head_sha: sha,
  created_at: new Date(createdAt).toISOString(),
});
const push = (created, sha = candidate) => ({
  uid: `dpl_${created}`,
  created,
  meta: { githubCommitSha: sha },
});
const query = (path) => new URL(path, "https://fixture.test").searchParams;

// GitHub pages are indexed by `page`; Vercel pages follow `until`.
function sources({
  runs = [[run(clock - 2 * day)]],
  total = runs.flat().length,
  deployments = [[push(clock - 2 * day)]],
} = {}) {
  const reads = [];
  const github = async (path) => {
    reads.push(path);
    const page = Number(query(path).get("page"));
    return { total_count: total, workflow_runs: runs[page - 1] ?? [] };
  };
  const vercel = async (path) => {
    reads.push(path);
    const until = query(path).get("until");
    const index = until === null ? 0 : Number(until);
    return {
      deployments: deployments[index] ?? [],
      pagination: index + 1 < deployments.length ? { next: index + 1 } : {},
    };
  };
  return { github, vercel, reads };
}

test("the start is the earlier of both candidate records less the margin", async () => {
  const fullPage = Array.from({ length: 100 }, (_, i) => run(clock - i * 1000));
  const s = sources({
    runs: [fullPage, [run(clock - 5 * day)]],
    deployments: [[push(clock - 3 * day)], [push(clock - day)]],
  });
  assert.equal(
    await candidateHistoryStart(s.github, s.vercel, candidate),
    clock - 5 * day - candidateHistoryMarginMs,
  );
  // A Vercel record older than every retained run lowers the start.
  const earlier = sources({ deployments: [[push(clock - 9 * day)]] });
  assert.equal(
    await candidateHistoryStart(earlier.github, earlier.vercel, candidate),
    clock - 9 * day - candidateHistoryMarginMs,
  );
});

test("missing, mismatched or truncated candidate history fails closed", async () => {
  const cases = [
    sources({ runs: [[]] }),
    sources({ deployments: [[]] }),
    sources({ runs: [[run(clock, "0".repeat(40))]] }),
    sources({ deployments: [[push(clock, "0".repeat(40))]] }),
    sources({ runs: [[{ head_sha: candidate, created_at: "not a time" }]] }),
    sources({ deployments: [[{ created: clock, meta: {} }]] }),
    sources({ total: 2 }),
    sources({ runs: [[run(clock)]], total: 0 }),
    sources({
      runs: Array.from({ length: 10 }, () =>
        Array.from({ length: 100 }, () => run(clock)),
      ),
    }),
    sources({
      deployments: Array.from({ length: 11 }, () => [push(clock)]),
    }),
  ];
  for (const s of cases)
    await assert.rejects(candidateHistoryStart(s.github, s.vercel, candidate));
  const s = sources();
  await assert.rejects(candidateHistoryStart(s.github, s.vercel, "abc"));
  await assert.rejects(
    candidateHistoryStart(async () => ({}), s.vercel, candidate),
  );
  await assert.rejects(
    candidateHistoryStart(s.github, async () => ({}), candidate),
  );
  await assert.rejects(
    candidateHistoryStart(
      s.github,
      async () => ({ deployments: [push(clock)], pagination: { next: -1 } }),
      candidate,
    ),
  );
});

test("the deployment scan keeps its reviewed ten-page bound", async () => {
  let calls = 0;
  const endless = async () => {
    calls += 1;
    return { deployments: [], pagination: { next: clock - calls } };
  };
  await assert.rejects(
    refuseEarlierStage({ candidate }, endless, "maintenance", clock),
    /exceeds its reviewed bound/u,
  );
  assert.equal(calls, 10);
});

test("preparation scans from the candidate records, not the whole project", async () => {
  const f = controllerFixture("prepare");
  const since = clock - 2 * day - candidateHistoryMarginMs;
  const scanned = [];
  const original = f.dependencies.vercel;
  f.dependencies.vercel = (path, ...rest) => {
    if (path.startsWith("/v6/deployments?") && path.includes("&since=")) {
      scanned.push(query(path).get("since"));
      // Older project history beyond the page bound must not be required.
      if (!path.includes(`&since=${since}`))
        return Promise.resolve({ deployments: [], pagination: { next: 1 } });
    }
    return original(path, ...rest);
  };
  const receipt = await runDevelopmentCutover(f.config, f.dependencies);
  assert.equal(receipt.phase, "prepared");
  assert.deepEqual([...new Set(scanned)], [String(since)]);
});

test("preparation refuses before any write when a candidate record is missing", async () => {
  for (const kind of ["github", "vercel"]) {
    const f = controllerFixture("prepare");
    const original = f.dependencies[kind];
    f.dependencies[kind] = (path, ...rest) =>
      kind === "github" && path.startsWith("/actions/runs?head_sha=")
        ? Promise.resolve({ total_count: 0, workflow_runs: [] })
        : kind === "vercel" && path.includes(`&sha=${candidate}`)
          ? Promise.resolve({ deployments: [], pagination: {} })
          : original(path, ...rest);
    await assert.rejects(runDevelopmentCutover(f.config, f.dependencies));
    assert.deepEqual(f.state.writes, [], kind);
  }
});
