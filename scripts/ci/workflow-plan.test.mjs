import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { preflightArguments, resolveBase } from "./preflight.mjs";
import {
  evaluateExpression,
  interpolate,
  pullRequestContext,
  pullRequestPlan,
  scheduleSteps,
} from "./workflow-plan.mjs";

const baseSha = "a".repeat(40);
const workflowSource = readFileSync(
  join(import.meta.dir, "../../.github/workflows/ci.yml"),
  "utf8",
);

describe("workflow expressions", () => {
  const context = {
    ...pullRequestContext({ baseSha }),
    matrix: { shard: 2 },
    strategy: { "job-total": 3 },
  };

  test("evaluates the conditions the workflow uses", () => {
    for (const [expression, expected] of [
      ["github.event_name == 'pull_request'", true],
      ["github.event_name != 'pull_request'", false],
      [
        "github.event_name == 'pull_request' || github.event_name == 'merge_group'",
        true,
      ],
      [
        "github.event_name != 'pull_request' && github.event_name != 'merge_group'",
        false,
      ],
      [
        "github.event_name != 'pull_request' || github.event.pull_request.draft == false",
        true,
      ],
      ["always() && (github.event_name != 'pull_request')", false],
      ["matrix.shard == 1", false],
      ["matrix.shard == 2", true],
      ["!(matrix.shard == 2)", false],
      ["github.event.merge_group.base_sha", null],
      ["github.event.pull_request.base.sha || 'fallback'", baseSha],
      ["github.event.merge_group.base_sha || 'fallback'", "fallback"],
      ["strategy.job-total", 3],
      ["startsWith(github.ref, 'refs/pull/')", true],
      ["startsWith(github.ref, 'refs/heads/gh-readonly-queue/main/')", false],
      ["'It''s' == 'it''s'", true],
      ["null == false", true],
      ["fromJSON('[1, 2]')", [1, 2]],
      [
        "fromJSON((github.event_name == 'pull_request') && '[1, 2]' || '[1, 2, 3]')",
        [1, 2],
      ],
    ]) {
      expect(evaluateExpression(expression, context), expression).toEqual(
        expected,
      );
    }
  });

  test("substitutes expressions inside commands", () => {
    expect(
      interpolate(
        'bun run test:affected "$PR_BASE_SHA" --shard=${{ matrix.shard }}/${{ strategy.job-total }}',
        context,
      ),
    ).toBe('bun run test:affected "$PR_BASE_SHA" --shard=2/3');
    expect(
      interpolate(
        "${{ (github.event_name == 'pull_request') && 'pr-quality' || 'full-quality' }}",
        context,
      ),
    ).toBe("pr-quality");
    // Shell parameter expansion is not a workflow expression.
    expect(interpolate('echo "${HOME}" ${{ secrets.MISSING }}', context)).toBe(
      'echo "${HOME}" ',
    );
  });

  test("refuses what it does not understand instead of guessing", () => {
    for (const expression of [
      "contains(github.ref, 'x')",
      "github.event_name === 'pull_request'",
      "matrix.shard > 1",
      "(matrix.shard == 1",
      "matrix.shard == 1)",
      "hashFiles('bun.lock')",
    ]) {
      expect(() => evaluateExpression(expression, context), expression).toThrow(
        "Unsupported workflow",
      );
    }
  });
});

describe("the pull request plan read from ci.yml", () => {
  const plan = pullRequestPlan(workflowSource, { baseSha });
  const commands = plan.steps.map((step) => step.run.trim());

  test("covers the pull request jobs and no full-path job", () => {
    expect(plan.jobs.map((job) => job.label)).toEqual([
      "static-checks",
      "unit-tests (1/2)",
      "unit-tests (2/2)",
      "pr-quality",
      "ci-gate",
    ]);
    expect(new Set(plan.steps.map((step) => step.lane))).toEqual(
      new Set(["static", "unit"]),
    );
  });

  test("runs every gate command a developer machine can run, in workflow order", () => {
    const staticCommands = plan.steps
      .filter((step) => step.lane === "static")
      .map((step) => step.run.trim());
    expect(staticCommands).toEqual([
      "bun run plugin:submodules:check:strict",
      "bun run agent:check",
      "bun install --frozen-lockfile",
      "bun run security:audit",
      "bun run format:check",
      "bun run security:seeds\nbun run test:security:seeds",
      "bun run lint",
      "bun run plugin:check:boundary",
      "bun run plugin:apps:contract",
      "bun run typecheck",
      "bun test scripts/ci/*.test.mjs scripts/audit-agent-tooling.test.mjs",
    ]);
    expect(
      plan.steps
        .filter((step) => step.lane === "unit")
        .map((step) => `${step.job}: ${step.run.trim()}`),
    ).toEqual([
      "unit-tests (1/2): bun run plugin:submodules:check:strict",
      "unit-tests (1/2): bun install --frozen-lockfile",
      'unit-tests (1/2): bun run test:affected "$PR_BASE_SHA" --shard=1/2',
      "unit-tests (2/2): bun run plugin:submodules:check:strict",
      "unit-tests (2/2): bun install --frozen-lockfile",
      'unit-tests (2/2): bun run test:affected "$PR_BASE_SHA" --shard=2/2',
    ]);
  });

  test("gives the affected-test step the requested base and nothing unresolved", () => {
    const affected = plan.steps.filter((step) =>
      step.run.includes("test:affected"),
    );
    expect(affected).toHaveLength(2);
    for (const step of affected) expect(step.env.PR_BASE_SHA).toBe(baseSha);
    for (const step of plan.steps) {
      expect(step.run).not.toContain("${{");
      expect(Object.values(step.env).join("\n")).not.toContain("${{");
      // Workflow-level settings reach every step, as they do on a runner.
      expect(step.env.SUPABASE_EXPERIMENTAL_STACK).toBe("0");
      expect(step.env.PRIVATE_PLUGINS_BRANCH).toBe("development");
    }
  });

  test("leaves out the full-path commands", () => {
    for (const fullOnly of [
      "bun run build",
      "bun run plugin:apps:check",
      "bun run plugin:sdk:test",
      "bun run plugin:test:release-integration",
      "bun run csf:test:e2e",
      "bun run dev:test:cron",
    ]) {
      expect(commands.some((command) => command.startsWith(fullOnly))).toBe(
        false,
      );
    }
    expect(
      commands.some((command) => /^bun run test( |$)/u.test(command)),
    ).toBe(false);
  });

  test("names every runner-only step it skips, with the reason", () => {
    const reasons = new Map(
      plan.skipped.map((step) => [step.name, step.reason]),
    );
    expect(Object.fromEntries(reasons)).toEqual({
      "Require private submodule access": "reads a runner secret",
      "Checkout root": "runner action (actions/checkout)",
      "Resolve exact private plugin gitlink": "writes runner state",
      "Checkout exact private plugin gitlink":
        "runner action (actions/checkout)",
      "Normalize private plugin remote metadata":
        "rewires the runner's checkout",
      "Setup Node": "runner action (actions/setup-node)",
      "Setup Bun": "runner action (oven-sh/setup-bun)",
      "Install source audit tools": "installs a runner package",
      "Require the applicable quality jobs": "compares other jobs' results",
      "Require the applicable validation jobs": "compares other jobs' results",
    });
    // Nothing is dropped silently: every pull request step is run or named.
    const skippedOrRun = new Set([
      ...plan.skipped.map((step) => step.name),
      ...plan.steps.map((step) => step.name),
    ]);
    for (const name of [
      "Validate exact private plugin gitlink",
      "Audit every independent package graph",
      "Check formatting",
      "Validate Supabase seed safety",
      "Lint",
      "Typecheck",
      "Test affected pull request units",
      "Test pull request tooling contracts",
    ]) {
      expect(skippedOrRun.has(name), name).toBe(true);
    }
    // No step that changes git state or needs a credential is ever run.
    for (const command of commands) {
      expect(command).not.toMatch(/\bsudo\b|GITHUB_|git submodule|git -C/u);
    }
  });

  test("shared commands run once, and each job keeps its own order", () => {
    const { setup, lanes } = scheduleSteps(plan.steps);
    expect(setup.map((step) => step.run.trim())).toEqual([
      "bun run plugin:submodules:check:strict",
      "bun install --frozen-lockfile",
    ]);
    expect(lanes).toHaveLength(2);
    const [staticLane, unitLane] = lanes;
    expect(staticLane.map((step) => step.name)).toEqual([
      "Audit agent and tool configuration",
      "Audit every independent package graph",
      "Check formatting",
      "Validate Supabase seed safety",
      "Lint",
      "Check plugin/host import boundary",
      "Check private application contracts",
      "Typecheck",
      "Test pull request tooling contracts",
    ]);
    // Shards share one working tree locally, so they sit in one lane and run
    // one after the other.
    expect(unitLane.map((step) => step.run.trim())).toEqual([
      'bun run test:affected "$PR_BASE_SHA" --shard=1/2',
      'bun run test:affected "$PR_BASE_SHA" --shard=2/2',
    ]);
    const scheduled = [...setup, ...lanes.flat()].length;
    expect(scheduled).toBe(new Set(plan.steps.map((s) => s.run)).size);
  });
});

describe("workflow parsing on small inputs", () => {
  const minimal = (jobs) => `on:\n  pull_request:\njobs:\n${jobs}`;

  test("applies job and step conditions, matrices, and environment layers", () => {
    const plan = pullRequestPlan(
      `env:\n  LAYER: workflow\n  SHARED: workflow\n${minimal(`  full:
    if: github.event_name != 'pull_request'
    steps:
      - run: echo never
  checks:
    name: checks (\${{ matrix.part }})
    strategy:
      matrix:
        part: [a, b]
    env:
      SHARED: job
    steps:
      - uses: actions/checkout@0000000000000000000000000000000000000000
      - name: Only the first
        if: matrix.part == 'a'
        run: echo first \${{ matrix.part }}
      - name: Both
        env:
          SHARED: step
          TOTAL: \${{ strategy.job-total }}
        run: |
          echo one
          echo two
`)}`,
      { baseSha },
    );
    expect(plan.jobs.map((job) => job.label)).toEqual([
      "checks (a)",
      "checks (b)",
    ]);
    expect(
      plan.steps.map((step) => [step.job, step.name, step.run, step.env]),
    ).toEqual([
      [
        "checks (a)",
        "Only the first",
        "echo first a",
        { LAYER: "workflow", SHARED: "job" },
      ],
      [
        "checks (a)",
        "Both",
        "echo one\necho two\n",
        { LAYER: "workflow", SHARED: "step", TOTAL: "2" },
      ],
      [
        "checks (b)",
        "Both",
        "echo one\necho two\n",
        { LAYER: "workflow", SHARED: "step", TOTAL: "2" },
      ],
    ]);
    expect(plan.skipped).toEqual([
      {
        job: "checks (a)",
        lane: "checks",
        name: "step 1",
        reason: "runner action (actions/checkout)",
      },
      {
        job: "checks (b)",
        lane: "checks",
        name: "step 1",
        reason: "runner action (actions/checkout)",
      },
    ]);
  });

  test("fails closed on an empty plan or an unreadable workflow", () => {
    expect(() =>
      pullRequestPlan(
        minimal(
          "  full:\n    if: github.event_name != 'pull_request'\n    steps:\n      - run: echo never\n",
        ),
        { baseSha },
      ),
    ).toThrow("runs no steps for a pull request");
    expect(() => pullRequestPlan("on: push\n", { baseSha })).toThrow("no jobs");
    expect(() =>
      pullRequestPlan(
        minimal(
          "  odd:\n    if: contains(github.ref, 'x')\n    steps:\n      - run: echo\n",
        ),
        { baseSha },
      ),
    ).toThrow("Unsupported workflow");
  });
});

describe("preflight arguments", () => {
  test("accepts a base, serial mode, and a listing", () => {
    expect(preflightArguments([])).toEqual({
      base: null,
      serial: false,
      list: false,
    });
    expect(preflightArguments(["--base", baseSha, "--serial"])).toEqual({
      base: baseSha,
      serial: true,
      list: false,
    });
    expect(preflightArguments([`--base=${baseSha}`, "--list"])).toEqual({
      base: baseSha,
      serial: false,
      list: true,
    });
    expect(() => preflightArguments(["--bogus"])).toThrow("Unknown argument");
  });

  test("resolves the base to an exact commit without shell interpolation", () => {
    const calls = [];
    const run = (args) => {
      calls.push(args);
      return baseSha;
    };
    expect(resolveBase(null, run)).toBe(baseSha);
    expect(resolveBase("origin/main", run)).toBe(baseSha);
    expect(calls).toEqual([
      ["merge-base", "HEAD", "origin/development"],
      ["rev-parse", "--verify", "origin/main^{commit}"],
    ]);
    for (const injected of ["main;echo unexpected", "--upload-pack=x", ""]) {
      expect(() => resolveBase(injected, run), injected).toThrow(
        "Invalid --base",
      );
    }
    expect(() =>
      resolveBase(null, () => {
        throw new Error("no ref");
      }),
    ).toThrow("pass --base <sha>");
    expect(() => resolveBase("deadbeef", () => "not-a-sha")).toThrow(
      "Could not resolve",
    );
  });
});
