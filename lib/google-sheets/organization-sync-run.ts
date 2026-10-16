import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";

import type {
  SheetCellValue,
  SheetsWriteOutcome,
} from "@/services/google-sheets-report";

/** The most a saved report may weigh, measured the way the database measures it. */
export const ORGANIZATION_SHEET_SYNC_MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
/** One finalize, and at most two more when its answer does not arrive. */
export const ORGANIZATION_SHEET_SYNC_FINALIZE_ATTEMPTS = 3;

/**
 * The report one run writes, saved before its first mutation. A retry reads
 * this back and replays it. It is never rebuilt while the run is unresolved.
 */
export type OrganizationSheetSyncSnapshot = {
  sheet_id: string;
  report_type: string;
  tab_name: string;
  /** Where the report is written from, after the legacy default is opened. */
  write_range_a1: string | null;
  /** The saved range that bounds stale-cell clearing. */
  stale_clear_range_a1: string | null;
  /** The exact ranges the run mutates: the write, then each clear. */
  ranges: string[];
  value_input_option: "RAW";
  rows: SheetCellValue[][];
};

type Rpc = (
  name: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: unknown }>;

type RunScope = {
  organization_id: string;
  sheet_id: string;
  created_by: string;
  updated_at: string;
};

// A number here is always finite: the schema refuses NaN and infinities.
const cellSchema = z.union([z.string(), z.number()]);
const planSchema = z
  .object({
    sheet_id: z.string().min(1),
    report_type: z.string().min(1),
    tab_name: z.string().min(1).max(200),
    write_range_a1: z.string().nullable(),
    stale_clear_range_a1: z.string().nullable(),
    ranges: z.array(z.string().min(1).max(500)).min(1).max(3),
    value_input_option: z.literal("RAW"),
  })
  .strict();
const claimSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("busy") }).strict(),
  z.object({ status: z.literal("outcome_unknown") }).strict(),
  z
    .object({
      status: z.literal("claimed"),
      claim_token: z.string().uuid(),
      run_id: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      status: z.literal("resume"),
      claim_token: z.string().uuid(),
      run_id: z.string().uuid(),
      plan: planSchema,
      rows: z.array(z.array(cellSchema)),
    })
    .strict(),
]);

/**
 * Checks a report against the saved-report bounds: plain text and finite
 * numbers only, and no heavier than the database accepts. Returns the reason
 * instead when the report cannot be saved.
 */
export function buildOrganizationSheetSyncSnapshot(
  plan: Omit<OrganizationSheetSyncSnapshot, "rows" | "value_input_option">,
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
): OrganizationSheetSyncSnapshot | "invalid" | "too_large" {
  const parsedRows = z.array(z.array(cellSchema)).safeParse(rows);
  const parsedPlan = planSchema.safeParse({
    ...plan,
    value_input_option: "RAW",
  });
  if (!parsedRows.success || !parsedPlan.success) return "invalid";
  const cellCount = parsedRows.data.reduce(
    (total, row) => total + row.length,
    0,
  );
  // The database measures its own rendering, which puts a space after each
  // separator. Counting one per row and cell keeps this bound the stricter one.
  const bytes =
    Buffer.byteLength(JSON.stringify(parsedRows.data), "utf8") +
    parsedRows.data.length +
    cellCount;
  if (bytes > ORGANIZATION_SHEET_SYNC_MAX_SNAPSHOT_BYTES) return "too_large";
  return { ...parsedPlan.data, rows: parsedRows.data };
}

export type OrganizationSheetSyncRun = {
  /** Saves the report. Resolves false when it was not affirmatively saved. */
  plan: (snapshot: OrganizationSheetSyncSnapshot) => Promise<boolean>;
  /** Durably records that the next mutation is about to be sent. */
  beginMutation: () => Promise<void>;
  /** Durably records what the provider answered for the begun mutation. */
  acknowledgeMutation: (outcome: SheetsWriteOutcome) => Promise<void>;
  /**
   * Stamps the saved configuration. Resolves true only on an exact receipt.
   * False means completion was not confirmed, not that it did not happen.
   */
  finalize: () => Promise<boolean>;
  release: () => Promise<void>;
  /** True once a mutation may have reached the provider without a saved answer. */
  outcomeUnknown: () => boolean;
};

export type OrganizationSheetSyncClaim =
  | { status: "claimed"; run: OrganizationSheetSyncRun }
  | {
      status: "resume";
      run: OrganizationSheetSyncRun;
      snapshot: OrganizationSheetSyncSnapshot;
    }
  | { status: "busy" }
  | { status: "outcome_unknown" }
  | { status: "refused" };

/**
 * Claims the organization's one sheet export. Only a claimed or resumed run
 * may build, read or write anything. Token material never enters these calls.
 */
export async function claimOrganizationSheetSyncRun(
  rpc: Rpc,
  config: RunScope,
): Promise<OrganizationSheetSyncClaim> {
  const scope = {
    p_actor: config.created_by,
    p_organization: config.organization_id,
  };
  let claimed: z.infer<typeof claimSchema>;
  try {
    const result = await rpc("claim_organization_sheet_sync_run", {
      ...scope,
      p_sheet_id: config.sheet_id,
      p_config_updated_at: config.updated_at,
    });
    const parsed = claimSchema.safeParse(result.data);
    if (result.error || !parsed.success) return { status: "refused" };
    claimed = parsed.data;
  } catch {
    return { status: "refused" };
  }
  if (claimed.status === "busy") return { status: "busy" };
  if (claimed.status === "outcome_unknown")
    return { status: "outcome_unknown" };

  const { claim_token: claimToken, run_id: runId } = claimed;
  let completedSteps = 0;
  let inflight: { request_id: string; step: number } | null = null;
  let uncertain = false;
  let finished = false;
  /**
   * `data` is the returned value, or null when the step was not confirmed.
   * `refused` is true only when the database itself answered with an error,
   * which means the step was rolled back and saved nothing.
   */
  const advance = async (step: string, payload: object = {}) => {
    try {
      const result = await rpc("advance_organization_sheet_sync_run", {
        ...scope,
        p_claim: claimToken,
        p_step: step,
        p_payload: payload,
      });
      if (!result.error)
        return {
          data: (result.data ?? null) as Record<string, unknown> | null,
          refused: false,
        };
      const code = (result.error as { code?: unknown }).code;
      return {
        data: null,
        refused: typeof code === "string" && /^[0-9A-Z]{5}$/u.test(code),
      };
    } catch {
      return { data: null, refused: false };
    }
  };
  const acknowledge = async (
    request: { request_id: string; step: number },
    outcome: SheetsWriteOutcome,
  ) => {
    const { data, refused } = await advance("acknowledge", {
      ...request,
      outcome,
    });
    return {
      // The answer must name this request, this step and this outcome.
      saved:
        data?.acknowledged === true &&
        data.request_id === request.request_id &&
        data.step === request.step &&
        data.outcome === outcome,
      refused,
    };
  };
  const instant = (value: unknown) =>
    typeof value === "string" ? Date.parse(value) : Number.NaN;
  const isExactCompletion = (receipt: Record<string, unknown> | null) => {
    if (!receipt) return false;
    const revision = instant(receipt.config_updated_at);
    // An unreadable time is never equal to anything, including itself.
    return (
      receipt.completed === true &&
      receipt.organization_id === config.organization_id &&
      receipt.actor_user_id === config.created_by &&
      receipt.run_id === runId &&
      receipt.sheet_id === config.sheet_id &&
      Number.isFinite(revision) &&
      revision === Date.parse(config.updated_at) &&
      Number.isFinite(instant(receipt.last_synced_at))
    );
  };

  const run: OrganizationSheetSyncRun = {
    async plan(snapshot) {
      const { rows, ...plan } = snapshot;
      const { data } = await advance("plan", { plan, rows });
      return (
        data?.planned === true &&
        data.run_id === runId &&
        data.step_count === plan.ranges.length
      );
    },
    async beginMutation() {
      if (uncertain || inflight)
        throw new Error("Sheet mutation outcome is unresolved");
      const request = { request_id: randomUUID(), step: completedSteps };
      const begun = await advance("begin", request);
      if (
        begun.data?.begun === true &&
        begun.data.request_id === request.request_id &&
        begun.data.step === request.step
      ) {
        inflight = request;
        return;
      }
      if (!begun.refused) {
        // The begin may have been saved even though its answer was lost.
        // Nothing was sent, so record that. Only a saved answer or a database
        // refusal proves that no request is left open.
        const unsent = await acknowledge(request, "unsent");
        if (!unsent.saved && !unsent.refused) uncertain = true;
      }
      throw new Error("Sheet mutation could not begin");
    },
    async acknowledgeMutation(outcome) {
      const request = inflight;
      if (!request) throw new Error("No sheet mutation is in flight");
      if (!(await acknowledge(request, outcome)).saved) {
        // An answer that was not saved is an unknown outcome for every later run.
        uncertain = true;
        throw new Error("Sheet mutation acknowledgement was not saved");
      }
      inflight = null;
      if (outcome === "completed") completedSteps += 1;
    },
    async finalize() {
      if (uncertain || inflight) return false;
      // A finalize with no answer may have been saved. Asking again with the
      // same claim reads that receipt back: the database re-sends nothing and
      // stamps nothing twice. A refusal or any other answer is final.
      for (
        let attempt = 0;
        attempt < ORGANIZATION_SHEET_SYNC_FINALIZE_ATTEMPTS;
        attempt += 1
      ) {
        const { data: receipt, refused } = await advance("finalize");
        if (receipt === null && !refused) continue;
        finished = isExactCompletion(receipt);
        return finished;
      }
      return false;
    },
    async release() {
      if (finished) return;
      // The database keeps an unacknowledged mutation, the saved report, and
      // the receipt of a completion this caller could not confirm.
      const { data } = await advance("release");
      if (data?.status === "outcome_unknown") uncertain = true;
    },
    outcomeUnknown: () => uncertain || inflight !== null,
  };

  if (claimed.status === "claimed") return { status: "claimed", run };
  return {
    status: "resume",
    run,
    snapshot: { ...claimed.plan, rows: claimed.rows },
  };
}
