import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const {
  buildOrganizationSheetSyncSnapshot,
  claimOrganizationSheetSyncRun,
  ORGANIZATION_SHEET_SYNC_MAX_SNAPSHOT_BYTES,
} = await import("./organization-sync-run");

const CLAIM = "ab000000-0000-4000-8000-000000000001";
const RUN = "ab000000-0000-4000-8000-000000000002";
const config = {
  organization_id: "org-1",
  sheet_id: "sheet-1",
  created_by: "owner-1",
  updated_at: "2026-10-11T00:00:00.000Z",
};
const plan = {
  sheet_id: "sheet-1",
  report_type: "member-hours",
  tab_name: "Member Hours",
  write_range_a1: "A1",
  stale_clear_range_a1: "A1",
  ranges: ["'Member Hours'!A1:B2"],
};
const REFUSED = { data: null, error: { code: "55000" } };
const LOST = { data: null, error: { message: "fixture transport" } };

type Answer = { data: unknown; error: unknown };
let steps: Array<{ step: string; payload: Record<string, unknown> }> = [];
let claimAnswer: Answer;
/** Answers one step. The default echoes an affirmative receipt. */
let answer: (step: string, payload: Record<string, unknown>) => Answer | null;

const receipt = (step: string, payload: Record<string, unknown>): Answer => {
  const data: Record<string, unknown> = {
    plan: { planned: true, run_id: RUN, step_count: 1 },
    begin: { begun: true, request_id: payload.request_id, step: payload.step },
    acknowledge: {
      acknowledged: true,
      request_id: payload.request_id,
      step: payload.step,
      outcome: payload.outcome,
    },
    finalize: {
      completed: true,
      organization_id: "org-1",
      actor_user_id: "owner-1",
      run_id: RUN,
      sheet_id: "sheet-1",
      config_updated_at: "2026-10-11T00:00:00+00:00",
      last_synced_at: "2026-10-11T00:00:05+00:00",
    },
    release: { released: true },
  };
  return { data: data[step], error: null };
};
const rpc = async (name: string, args: Record<string, unknown>) => {
  if (name === "claim_organization_sheet_sync_run") return claimAnswer;
  const step = String(args.p_step);
  const payload = args.p_payload as Record<string, unknown>;
  steps.push({ step, payload });
  return answer(step, payload) ?? receipt(step, payload);
};
const stepNames = () => steps.map((entry) => entry.step);
const claimed = async () => {
  const claim = await claimOrganizationSheetSyncRun(rpc, config);
  if (claim.status !== "claimed") throw new Error("Expected a claimed run");
  return claim.run;
};

beforeEach(() => {
  steps = [];
  claimAnswer = {
    data: { status: "claimed", claim_token: CLAIM, run_id: RUN },
    error: null,
  };
  answer = () => null;
});

describe("the saved report", () => {
  test("keeps text and numbers exactly and always writes RAW", () => {
    const rows = [
      ["Name", "Hours"],
      ["=SUM(A1)", 12.5],
      ["2024", 0],
    ];
    expect(buildOrganizationSheetSyncSnapshot(plan, rows)).toEqual({
      ...plan,
      value_input_option: "RAW",
      rows,
    });
  });

  test.each([
    ["null", null],
    ["a boolean", true],
    ["an object", { formula: "=1" }],
    ["a nested row", ["x"]],
    ["NaN", Number.NaN],
    ["an infinity", Number.POSITIVE_INFINITY],
  ])("refuses a cell holding %s", (_name, cell) => {
    expect(buildOrganizationSheetSyncSnapshot(plan, [["ok", cell]])).toBe(
      "invalid",
    );
  });

  test("refuses more than one write and two clears, and a payload past the byte bound", () => {
    expect(
      buildOrganizationSheetSyncSnapshot(
        { ...plan, ranges: ["a", "b", "c", "d"] },
        [["x"]],
      ),
    ).toBe("invalid");
    expect(
      buildOrganizationSheetSyncSnapshot({ ...plan, ranges: [] }, [["x"]]),
    ).toBe("invalid");

    const heavy = "x".repeat(1024);
    const rows = Array.from(
      { length: ORGANIZATION_SHEET_SYNC_MAX_SNAPSHOT_BYTES / 1024 },
      () => [heavy],
    );
    expect(buildOrganizationSheetSyncSnapshot(plan, rows)).toBe("too_large");
  });
});

describe("the claim", () => {
  test("sends the actor and the configuration it read, and nothing else", async () => {
    const seen: unknown[] = [];
    await claimOrganizationSheetSyncRun(async (name, args) => {
      seen.push([name, args]);
      return claimAnswer;
    }, config);

    expect(seen).toEqual([
      [
        "claim_organization_sheet_sync_run",
        {
          p_actor: "owner-1",
          p_organization: "org-1",
          p_sheet_id: "sheet-1",
          p_config_updated_at: "2026-10-11T00:00:00.000Z",
        },
      ],
    ]);
  });

  test.each(["busy", "outcome_unknown"] as const)(
    "reports %s without handing out a run",
    async (status) => {
      claimAnswer = { data: { status }, error: null };
      expect(await claimOrganizationSheetSyncRun(rpc, config)).toEqual({
        status,
      });
    },
  );

  test.each([
    ["a database refusal", REFUSED],
    ["a lost answer", LOST],
    ["an empty answer", { data: null, error: null }],
    ["an unknown status", { data: { status: "ready" }, error: null }],
    ["a claim without a token", { data: { status: "claimed" }, error: null }],
    [
      "a resume without its rows",
      {
        data: { status: "resume", claim_token: CLAIM, run_id: RUN, plan },
        error: null,
      },
    ],
  ])("treats %s as refused", async (_name, value) => {
    claimAnswer = value;
    expect(await claimOrganizationSheetSyncRun(rpc, config)).toEqual({
      status: "refused",
    });
  });

  test("a thrown claim is refused, not raised", async () => {
    const claim = await claimOrganizationSheetSyncRun(async () => {
      throw new Error("private database detail");
    }, config);
    expect(claim).toEqual({ status: "refused" });
  });

  test("a resumed run hands back the saved report unchanged", async () => {
    const rows = [["Name"], ["Volunteer"]];
    claimAnswer = {
      data: {
        status: "resume",
        claim_token: CLAIM,
        run_id: RUN,
        plan: { ...plan, value_input_option: "RAW" },
        rows,
      },
      error: null,
    };
    expect(await claimOrganizationSheetSyncRun(rpc, config)).toMatchObject({
      status: "resume",
      snapshot: { ...plan, value_input_option: "RAW", rows },
    });
  });
});

describe("mutation boundaries", () => {
  test("each mutation is begun with a fresh request and acknowledged with the same one", async () => {
    const run = await claimed();
    await run.beginMutation();
    await run.acknowledgeMutation("completed");
    await run.beginMutation();
    await run.acknowledgeMutation("rejected");
    await run.beginMutation();

    const [first, firstAck, second, secondAck, third] = steps;
    expect(stepNames()).toEqual([
      "begin",
      "acknowledge",
      "begin",
      "acknowledge",
      "begin",
    ]);
    expect(first.payload.step).toBe(0);
    expect(firstAck.payload).toEqual({
      ...first.payload,
      outcome: "completed",
    });
    // A completed step moves on. A rejected one is the step to retry.
    expect(second.payload.step).toBe(1);
    expect(secondAck.payload).toEqual({
      ...second.payload,
      outcome: "rejected",
    });
    expect(third.payload.step).toBe(1);
    expect(
      new Set([first, second, third].map((entry) => entry.payload.request_id))
        .size,
    ).toBe(3);
    // The third request is open until it is answered.
    expect(run.outcomeUnknown()).toBe(true);
  });

  test("a begin the database refused saved nothing and leaves nothing uncertain", async () => {
    answer = (step) => (step === "begin" ? REFUSED : null);
    const run = await claimed();

    await expect(run.beginMutation()).rejects.toThrow("could not begin");
    expect(stepNames()).toEqual(["begin"]);
    expect(run.outcomeUnknown()).toBe(false);
  });

  test("a begin whose answer was lost is closed as unsent", async () => {
    answer = (step) => (step === "begin" ? LOST : null);
    const run = await claimed();

    await expect(run.beginMutation()).rejects.toThrow("could not begin");
    expect(stepNames()).toEqual(["begin", "acknowledge"]);
    expect(steps[1].payload).toEqual({
      ...steps[0].payload,
      outcome: "unsent",
    });
    expect(run.outcomeUnknown()).toBe(false);
  });

  test("a lost begin that the database says was never saved is not uncertain", async () => {
    answer = (step) => (step === "begin" ? LOST : REFUSED);
    const run = await claimed();

    await expect(run.beginMutation()).rejects.toThrow();
    expect(run.outcomeUnknown()).toBe(false);
  });

  test("a lost begin that cannot be closed blocks the run", async () => {
    answer = () => LOST;
    const run = await claimed();

    await expect(run.beginMutation()).rejects.toThrow();
    expect(run.outcomeUnknown()).toBe(true);
    await expect(run.beginMutation()).rejects.toThrow("unresolved");
    expect(await run.finalize()).toBe(false);
    expect(stepNames()).not.toContain("finalize");
  });

  test.each([
    ["refused", REFUSED],
    ["lost", LOST],
    [
      "answered for another request",
      {
        data: { acknowledged: true, request_id: "other", outcome: "completed" },
        error: null,
      },
    ],
    ["answered without confirmation", { data: {}, error: null }],
  ])(
    "an acknowledgement that is %s leaves the outcome unknown",
    async (_name, value) => {
      const run = await claimed();
      await run.beginMutation();
      answer = (step) => (step === "acknowledge" ? value : null);

      await expect(run.acknowledgeMutation("completed")).rejects.toThrow(
        "not saved",
      );
      expect(run.outcomeUnknown()).toBe(true);
      expect(await run.finalize()).toBe(false);
      await expect(run.beginMutation()).rejects.toThrow("unresolved");
    },
  );

  test("nothing is acknowledged when no mutation was begun", async () => {
    const run = await claimed();
    await expect(run.acknowledgeMutation("completed")).rejects.toThrow();
    expect(steps).toHaveLength(0);
  });
});

describe("completion and release", () => {
  test("the report is saved only on an affirmative receipt for this run", async () => {
    const snapshot = buildOrganizationSheetSyncSnapshot(plan, [["x"]]);
    if (typeof snapshot === "string") throw new Error("Expected a snapshot");
    const run = await claimed();
    expect(await run.plan(snapshot)).toBe(true);
    expect(steps[0].payload).toEqual({
      plan: { ...plan, value_input_option: "RAW" },
      rows: [["x"]],
    });

    for (const value of [
      REFUSED,
      LOST,
      { data: {}, error: null },
      { data: { planned: true, run_id: CLAIM, step_count: 1 }, error: null },
      { data: { planned: true, run_id: RUN, step_count: 2 }, error: null },
    ]) {
      answer = () => value;
      expect(await run.plan(snapshot)).toBe(false);
    }
  });

  test("completion needs the exact actor, organization, spreadsheet, revision and run", async () => {
    const exact = receipt("finalize", {}).data as Record<string, unknown>;
    for (const change of [
      { completed: false },
      { organization_id: "org-2" },
      { actor_user_id: "owner-2" },
      { run_id: CLAIM },
      { sheet_id: "sheet-2" },
      { config_updated_at: "2026-10-11T00:00:01+00:00" },
      { config_updated_at: null },
      { last_synced_at: null },
    ]) {
      answer = () => ({ data: { ...exact, ...change }, error: null });
      expect(await (await claimed()).finalize()).toBe(false);
    }
    for (const value of [REFUSED, LOST, { data: null, error: null }]) {
      answer = () => value;
      expect(await (await claimed()).finalize()).toBe(false);
    }

    answer = () => null;
    const run = await claimed();
    steps = [];
    expect(await run.finalize()).toBe(true);
    // A finished run has no claim left to release.
    await run.release();
    expect(stepNames()).toEqual(["finalize"]);
  });

  test("a finalize whose answer was lost is asked again and reads the same receipt back", async () => {
    let finalizations = 0;
    answer = (step) => {
      if (step !== "finalize") return null;
      finalizations += 1;
      return finalizations === 1 ? LOST : null;
    };
    const run = await claimed();

    expect(await run.finalize()).toBe(true);
    // Only the finalize was repeated: no report, begin or acknowledgement.
    expect(stepNames()).toEqual(["finalize", "finalize"]);
    expect(steps[1]).toEqual(steps[0]);
    await run.release();
    expect(stepNames()).toEqual(["finalize", "finalize"]);
  });

  test("an empty answer is asked again too, and a refusal is not", async () => {
    let finalizations = 0;
    answer = (step) => {
      if (step !== "finalize") return null;
      finalizations += 1;
      return finalizations < 3 ? { data: null, error: null } : null;
    };
    expect(await (await claimed()).finalize()).toBe(true);
    expect(finalizations).toBe(3);

    steps = [];
    answer = (step) => (step === "finalize" ? REFUSED : null);
    expect(await (await claimed()).finalize()).toBe(false);
    expect(stepNames()).toEqual(["finalize"]);
  });

  test("a finalize that is never answered stops after three tries and stays unconfirmed", async () => {
    answer = (step) => (step === "finalize" ? LOST : null);
    const run = await claimed();

    expect(await run.finalize()).toBe(false);
    expect(stepNames()).toEqual(["finalize", "finalize", "finalize"]);
    // The claim is still released. The database keeps a saved completion.
    await run.release();
    expect(stepNames()).toEqual([
      "finalize",
      "finalize",
      "finalize",
      "release",
    ]);
    expect(run.outcomeUnknown()).toBe(false);
  });

  test("an answered finalize that is not an exact receipt is not asked again", async () => {
    const exact = receipt("finalize", {}).data as Record<string, unknown>;
    for (const change of [
      { last_synced_at: "invalid-date" },
      { last_synced_at: "" },
      { last_synced_at: 1791676805000 },
      { config_updated_at: "invalid-date" },
    ]) {
      steps = [];
      answer = () => ({ data: { ...exact, ...change }, error: null });
      expect(await (await claimed()).finalize()).toBe(false);
      expect(stepNames()).toEqual(["finalize"]);
    }

    // Two unreadable revisions are not an equal pair.
    answer = () => ({
      data: { ...exact, config_updated_at: "invalid-date" },
      error: null,
    });
    const claim = await claimOrganizationSheetSyncRun(rpc, {
      ...config,
      updated_at: "invalid-date",
    });
    if (claim.status !== "claimed") throw new Error("Expected a claimed run");
    expect(await claim.run.finalize()).toBe(false);
  });

  test("an acknowledgement for another step leaves the mutation unresolved", async () => {
    const run = await claimed();
    await run.beginMutation();
    answer = (step, payload) =>
      step === "acknowledge"
        ? {
            data: { acknowledged: true, ...payload, step: 99 },
            error: null,
          }
        : null;

    await expect(run.acknowledgeMutation("completed")).rejects.toThrow(
      "not saved",
    );
    expect(run.outcomeUnknown()).toBe(true);
    expect(await run.finalize()).toBe(false);
  });

  test("release reports an unacknowledged mutation instead of clearing it", async () => {
    const run = await claimed();
    await run.release();
    expect(stepNames()).toEqual(["release"]);
    expect(run.outcomeUnknown()).toBe(false);

    answer = (step) =>
      step === "release"
        ? { data: { released: false, status: "outcome_unknown" }, error: null }
        : null;
    const blocked = await claimed();
    await blocked.release();
    expect(blocked.outcomeUnknown()).toBe(true);
  });

  test("no run call carries more than the claim, the step and its payload", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const claim = await claimOrganizationSheetSyncRun(async (name, args) => {
      if (name !== "claim_organization_sheet_sync_run") calls.push(args);
      return name === "claim_organization_sheet_sync_run"
        ? claimAnswer
        : receipt(String(args.p_step), args.p_payload as never);
    }, config);
    if (claim.status !== "claimed") throw new Error("Expected a claimed run");
    await claim.run.beginMutation();
    await claim.run.acknowledgeMutation("completed");

    for (const args of calls) {
      expect(Object.keys(args).sort()).toEqual([
        "p_actor",
        "p_claim",
        "p_organization",
        "p_payload",
        "p_step",
      ]);
      expect(args).toMatchObject({
        p_actor: "owner-1",
        p_organization: "org-1",
        p_claim: CLAIM,
      });
    }
  });
});
