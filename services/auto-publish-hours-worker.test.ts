import { afterAll, beforeEach, expect, mock, test } from "bun:test";

// Imports the real worker and replaces every database, publication, and
// provider boundary. No HTTP or database call is possible.
mock.module("server-only", () => ({}));
mock.module("@/lib/safe-console", () => ({
  safeConsole: { log() {}, warn() {}, error() {} },
}));

type RpcCall = { name: string; args: Record<string, unknown> };
type RpcResult = { data: unknown; error: { code?: string } | null };
const rpcCalls: RpcCall[] = [];
let claimResult: RpcResult;
let recoveryResult: RpcResult;
let recoveryPending = 0;
let recoveryHeld = 0;
const counted = { counted: true, pending: 0, held: 0 };
mock.module("@supabase/supabase-js", () => ({
  createClient: () => ({
    from() {
      throw new Error("The worker must not page attendance rows itself");
    },
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      if (name === "claim_due_hours_publications") return claimResult;
      if (name === "claim_hours_publication_email_recovery") {
        // Fixtures name the selected groups. The database wraps them in its
        // counted inventory envelope.
        return Array.isArray(recoveryResult.data)
          ? {
              data: {
                counted: true,
                pendingDeliveries: recoveryPending,
                heldDeliveries: recoveryHeld,
                groups: recoveryResult.data,
              },
              error: null,
            }
          : recoveryResult;
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
  }),
}));

type PublicationInput = {
  actorId: string;
  projectId: string;
  scheduleId: string;
  entries: Array<Record<string, unknown>>;
  requestKey: string;
  origin?: string;
  claimedSnapshot?: boolean;
};
const publicationInputs: PublicationInput[] = [];
let publicationFailureCode: string | null = null;
mock.module("@/lib/projects/hours-publication-service", () => ({
  isTransactionalPublication: (value: unknown) =>
    !!value &&
    typeof value === "object" &&
    typeof (value as { receiptId?: unknown }).receiptId === "string" &&
    Array.isArray((value as { deliveries?: unknown }).deliveries),
  async publishVolunteerHoursTransaction(input: PublicationInput) {
    publicationInputs.push(input);
    if (publicationFailureCode) {
      return {
        publication: null,
        attempts: 2,
        errorCode: publicationFailureCode,
        invalidResponse: false,
      };
    }
    return {
      publication: {
        outcome: "accepted",
        receiptId: "fictional-new-receipt",
        requestKey: input.requestKey,
        certificatesCreated: input.entries.length,
        projectTitle: "Fictional cleanup",
        projectTimezone: "UTC",
        publicationOrigin: "automatic",
        deliveries: input.entries.map((entry, index) => ({
          deliveryId: `new-delivery-${index}`,
          state: "queued",
          payloadPrepared: false,
          idempotencyKey: `new-key-${index}`,
          certificateId: `new-certificate-${index}`,
        })),
      },
      attempts: 1,
      errorCode: null,
      invalidResponse: false,
    };
  },
}));

const drained: Array<{ receiptId: string; deliveryIds: string[] }> = [];
let drainOutcome: "accepted" | "retryable" | "unconfirmed" | "throws" =
  "accepted";
mock.module("@/lib/projects/hours-publication-email-service", () => ({
  async drainPublicationEmails(publication: {
    receiptId: string;
    deliveries: Array<{ deliveryId: string }>;
  }) {
    drained.push({
      receiptId: publication.receiptId,
      deliveryIds: publication.deliveries.map((row) => row.deliveryId),
    });
    if (drainOutcome === "throws") throw new Error("Synthetic drain fault");
    const count = publication.deliveries.length;
    return {
      emailsSent: drainOutcome === "retryable" ? 0 : count,
      errors: drainOutcome === "accepted" ? [] : ["synthetic"],
      partial: drainOutcome !== "accepted",
      settledAccepted: drainOutcome === "accepted" ? count : 0,
      settlementUnconfirmed: drainOutcome === "unconfirmed" ? count : 0,
    };
  },
}));

const { processExpiredSessions, resolveAutoPublishApproval } =
  await import("./auto-publish-hours-worker");
const { classifyWorkerResponse } = await import("@/lib/cron/worker-outcome");

const keys = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "AUTO_PUBLISH_APPROVED_FROM",
] as const;
const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
afterAll(() => {
  for (const key of keys) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

const noHeld = {
  historical: 0,
  oversized: 0,
  invalidAttendance: 0,
  missingCreator: 0,
  invalidSchedule: 0,
};
function entry(index: number) {
  return {
    signupId: `fictional-signup-${String(index).padStart(4, "0")}`,
    checkIn: "2026-01-02T10:00:00+00:00",
    checkOut: "2026-01-02T11:00:00+00:00",
    attendanceRevision: 3,
  };
}
function session(entries = 1, projectId = "fictional-project") {
  return {
    projectId,
    publishKey: "oneTime",
    scheduleId: "oneTime",
    creatorId: "fictional-organizer",
    projectTitle: "Fictional cleanup",
    entries: Array.from({ length: entries }, (_, index) => entry(index)),
  };
}
function claim(overrides: Record<string, unknown> = {}): RpcResult {
  return {
    data: {
      contended: false,
      counted: true,
      sessions: [],
      pendingSessions: 0,
      heldSessions: noHeld,
      ...overrides,
    },
    error: null,
  };
}
function recoveryGroup(deliveryIds: string[], receiptId = "committed-receipt") {
  return {
    projectId: "fictional-project",
    scheduleId: "oneTime",
    publication: {
      outcome: "replayed",
      receiptId,
      requestKey: "committed-request",
      certificatesCreated: deliveryIds.length,
      projectTitle: "Fictional cleanup",
      projectTimezone: "UTC",
      publicationOrigin: "automatic",
      deliveries: deliveryIds.map((deliveryId) => ({
        deliveryId,
        state: "retryable_failure",
        payloadPrepared: true,
        idempotencyKey: `key-${deliveryId}`,
        certificateId: `certificate-${deliveryId}`,
      })),
    },
  };
}
const claimCalls = () =>
  rpcCalls.filter((call) => call.name === "claim_due_hours_publications");
const recoveryCalls = () =>
  rpcCalls.filter(
    (call) => call.name === "claim_hours_publication_email_recovery",
  );

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:1";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-unused-key";
  process.env.AUTO_PUBLISH_APPROVED_FROM = "2026-01-01T00:00:00.000Z";
  rpcCalls.length = 0;
  publicationInputs.length = 0;
  drained.length = 0;
  publicationFailureCode = null;
  drainOutcome = "accepted";
  claimResult = claim();
  recoveryResult = { data: [], error: null };
  recoveryPending = 0;
  recoveryHeld = 0;
});

test("the approval boundary accepts only a complete past UTC instant", () => {
  const now = new Date("2026-10-11T12:00:00.000Z");
  expect(resolveAutoPublishApproval(undefined, now)).toEqual({
    status: "approval_required",
    reason: "missing",
  });
  expect(resolveAutoPublishApproval("", now)).toEqual({
    status: "approval_required",
    reason: "missing",
  });
  for (const invalid of [
    "2026-01-01",
    "2026-01-01T00:00:00",
    "2026-01-01T00:00:00+00:00",
    "2026-01-01T00:00:00-07:00",
    "2026-01-01 00:00:00Z",
    " 2026-01-01T00:00:00Z",
    "2026-01-01T00:00:00z",
    "2026-02-30T00:00:00Z",
    "2026-13-01T00:00:00Z",
    "2026-01-01T24:00:00Z",
    "2026-01-01T00:00:60Z",
    "1767225600000",
    "yesterday",
  ]) {
    expect(resolveAutoPublishApproval(invalid, now)).toEqual({
      status: "approval_required",
      reason: "invalid",
    });
  }
  expect(resolveAutoPublishApproval("2026-10-11T12:00:00.001Z", now)).toEqual({
    status: "approval_required",
    reason: "future",
  });
  expect(resolveAutoPublishApproval("2026-01-01T00:00:00Z", now)).toEqual({
    status: "approved",
    approvedFrom: "2026-01-01T00:00:00.000Z",
  });
  expect(resolveAutoPublishApproval("2026-10-11T12:00:00.000Z", now)).toEqual({
    status: "approved",
    approvedFrom: "2026-10-11T12:00:00.000Z",
  });
});

test("absent, malformed, offset, overflowing, and future approval publish nothing and report no counts", async () => {
  recoveryResult = { data: [recoveryGroup(["committed-1"])], error: null };
  for (const value of [
    undefined,
    "",
    "2026-01-01",
    "2026-01-01T00:00:00+00:00",
    "2026-02-30T00:00:00Z",
    "2999-01-01T00:00:00Z",
  ]) {
    if (value === undefined) delete process.env.AUTO_PUBLISH_APPROVED_FROM;
    else process.env.AUTO_PUBLISH_APPROVED_FROM = value;
    rpcCalls.length = 0;
    drained.length = 0;

    const result = await processExpiredSessions();

    expect(claimCalls()).toHaveLength(0);
    expect(publicationInputs).toHaveLength(0);
    expect(result.approvalStatus).toBe("approval_required");
    expect(result.processedSessions).toBe(0);
    expect(Object.hasOwn(result, "pendingSessions")).toBe(false);
    expect(result.discovery).toEqual({
      counted: false,
      contended: false,
      pendingSessions: null,
      heldSessions: null,
    });
    // The committed receipt was approved when it was written.
    expect(recoveryCalls()).toHaveLength(1);
    expect(drained).toEqual([
      { receiptId: "committed-receipt", deliveryIds: ["committed-1"] },
    ]);
    expect(result.recovery).toEqual({
      ...counted,
      deliveries: 1,
      accepted: 1,
      partial: 0,
      settlementUnconfirmed: 0,
    });
  }
});

test("an approved claim carries only the boundary and limit, with no upper age window", async () => {
  claimResult = claim({ sessions: [session(2)], pendingSessions: 4 });

  const result = await processExpiredSessions();

  expect(claimCalls()).toEqual([
    {
      name: "claim_due_hours_publications",
      args: { p_approved_from: "2026-01-01T00:00:00.000Z", p_limit: 10 },
    },
  ]);
  expect(result).toMatchObject({
    approvalStatus: "approved",
    processedSessions: 1,
    successfulSessions: 1,
    pendingSessions: 4,
  });
  expect(result.results[0]).toMatchObject({
    success: true,
    certificatesCreated: 2,
    deliveriesQueued: 2,
    errors: [],
  });
});

test("the claimed snapshot, revisions, and creator attribution reach the atomic publication unchanged", async () => {
  claimResult = claim({ sessions: [session(3)] });

  await processExpiredSessions();
  await processExpiredSessions();

  expect(publicationInputs).toHaveLength(2);
  expect(publicationInputs[0]).toMatchObject({
    actorId: "fictional-organizer",
    projectId: "fictional-project",
    scheduleId: "oneTime",
    origin: "automatic",
    claimedSnapshot: true,
    entries: [entry(0), entry(1), entry(2)],
  });
  expect(publicationInputs[0].requestKey).toMatch(
    /^hours-publication:v1:[0-9a-f]{64}$/u,
  );
  // The same snapshot must replay the same durable receipt.
  expect(publicationInputs[1].requestKey).toBe(publicationInputs[0].requestKey);
});

test("a changed revision or time is refused by publication and creates no award", async () => {
  claimResult = claim({ sessions: [session(2)] });
  publicationFailureCode = "PT409";

  const result = await processExpiredSessions();

  expect(publicationInputs).toHaveLength(1);
  expect(result.processedSessions).toBe(1);
  expect(result.successfulSessions).toBe(0);
  expect(result.results[0]).toMatchObject({
    success: false,
    certificatesCreated: 0,
    deliveriesQueued: 0,
  });
  expect(result.results[0].errors).toEqual([
    "Attendance changed after the claim; publication was refused (PT409)",
  ]);
  // One failed session does not stop the independent sweep.
  expect(recoveryCalls()).toHaveLength(1);
});

test("an oversized session is reported held and nothing is published", async () => {
  claimResult = claim({ heldSessions: { ...noHeld, oversized: 1 } });

  const result = await processExpiredSessions();

  expect(publicationInputs).toHaveLength(0);
  expect(result.processedSessions).toBe(0);
  expect(result.discovery.heldSessions).toEqual({ ...noHeld, oversized: 1 });
});

test("a snapshot above 1,000 entries is never truncated into a publication", async () => {
  claimResult = claim({ sessions: [session(1001), session(1, "second")] });

  const result = await processExpiredSessions();

  expect(publicationInputs.map((input) => input.projectId)).toEqual(["second"]);
  expect(publicationInputs.every((input) => input.entries.length === 1)).toBe(
    true,
  );
  expect(result.results[0]).toMatchObject({
    success: false,
    certificatesCreated: 0,
    errors: [
      "Session exceeds 1,000 attendance entries and is held for organizer review",
    ],
  });
  expect(result.successfulSessions).toBe(1);
});

test("held backlog is reported beside the ready session it does not starve", async () => {
  claimResult = claim({
    sessions: [session(1)],
    heldSessions: {
      historical: 500,
      oversized: 2,
      invalidAttendance: 7,
      missingCreator: 1,
      invalidSchedule: 3,
    },
  });

  const result = await processExpiredSessions();

  expect(result.successfulSessions).toBe(1);
  expect(result.discovery).toEqual({
    counted: true,
    contended: false,
    pendingSessions: 0,
    heldSessions: {
      historical: 500,
      oversized: 2,
      invalidAttendance: 7,
      missingCreator: 1,
      invalidSchedule: 3,
    },
  });
});

test("the worker result feeds the shared outcome arithmetic through its top-level aliases", async () => {
  const classify = async () =>
    classifyWorkerResponse("auto-publish-hours", 200, {
      ...(await processExpiredSessions()),
    });

  const empty = await classify();
  expect(empty).toMatchObject({ outcome: "no_run", code: "empty_queue" });

  claimResult = claim({ heldSessions: { ...noHeld, invalidSchedule: 1 } });
  const held = await processExpiredSessions();
  expect(held.discoveryCounted).toBe(true);
  expect(held.heldSessions).toEqual({ ...noHeld, invalidSchedule: 1 });
  expect(held.heldSessions).toEqual(held.discovery.heldSessions);
  expect(await classify()).toMatchObject({ outcome: "partial", refused: 1 });

  claimResult = claim({ sessions: [session(2)] });
  expect(await classify()).toMatchObject({
    outcome: "processed",
    attempted: 1,
    completed: 1,
  });

  // Published, but its mail was not durably accepted: never a finished pass.
  recoveryResult = { data: [recoveryGroup(["committed-1"])], error: null };
  drainOutcome = "unconfirmed";
  expect(await classify()).toMatchObject({
    outcome: "partial",
    completed: 1,
    pending: 1,
    faults: 1,
  });

  delete process.env.AUTO_PUBLISH_APPROVED_FROM;
  claimResult = claim();
  recoveryResult = { data: [], error: null };
  const unapproved = await processExpiredSessions();
  expect(unapproved.discoveryCounted).toBe(false);
  expect(unapproved.heldSessions).toBeNull();
  expect(await classify()).toMatchObject({
    outcome: "partial",
    code: "partial_work",
    refused: 1,
  });
});

test("a contended claim is explicit and invents no counts", async () => {
  claimResult = {
    data: {
      contended: true,
      counted: false,
      sessions: [],
      pendingSessions: null,
      heldSessions: null,
    },
    error: null,
  };

  const result = await processExpiredSessions();

  expect(result.approvalStatus).toBe("approved");
  expect(Object.hasOwn(result, "pendingSessions")).toBe(false);
  expect(result.discovery).toEqual({
    counted: false,
    contended: true,
    pendingSessions: null,
    heldSessions: null,
  });
  expect(recoveryCalls()).toHaveLength(1);
});

test("committed delivery work is recovered after the session flag commits", async () => {
  claimResult = claim({ sessions: [session(1)] });
  recoveryResult = {
    data: [recoveryGroup(["new-delivery-0"], "fictional-new-receipt")],
    error: null,
  };
  drainOutcome = "retryable";
  const first = await processExpiredSessions();
  expect(first.successfulSessions).toBe(1);
  expect(first.results[0].errors).toEqual([]);
  expect(first.recovery).toEqual({
    ...counted,
    deliveries: 1,
    accepted: 0,
    partial: 1,
    settlementUnconfirmed: 0,
  });

  // The session is published now, so discovery returns nothing. The retryable
  // delivery is still in the ledger and must be attempted again.
  claimResult = claim();
  drainOutcome = "accepted";
  const second = await processExpiredSessions();

  expect(second.processedSessions).toBe(0);
  expect(publicationInputs).toHaveLength(1);
  expect(drained).toHaveLength(2);
  expect(second.recovery).toEqual({
    ...counted,
    deliveries: 1,
    accepted: 1,
    partial: 0,
    settlementUnconfirmed: 0,
  });
});

test("one sweep is bounded to 25 deliveries across new and existing receipts", async () => {
  claimResult = claim({ sessions: [session(600)] });
  recoveryResult = {
    data: [
      recoveryGroup(
        Array.from({ length: 20 }, (_, index) => `old-${index}`),
        "old-receipt",
      ),
      recoveryGroup(
        Array.from({ length: 5 }, (_, index) => `new-${index}`),
        "fictional-new-receipt",
      ),
    ],
    error: null,
  };

  const result = await processExpiredSessions();

  expect(recoveryCalls()).toEqual([
    { name: "claim_hours_publication_email_recovery", args: { p_limit: 25 } },
  ]);
  // The 600 new deliveries are queued by the transaction, not drained inline.
  expect(result.results[0].deliveriesQueued).toBe(600);
  expect(drained.map((call) => call.deliveryIds.length)).toEqual([20, 5]);
  expect(result.recovery.deliveries).toBe(25);
});

test("uncertain provider acceptance is never counted as accepted", async () => {
  recoveryResult = {
    data: [recoveryGroup(["committed-1", "committed-2"])],
    error: null,
  };
  drainOutcome = "unconfirmed";

  expect((await processExpiredSessions()).recovery).toEqual({
    ...counted,
    deliveries: 2,
    accepted: 0,
    partial: 2,
    settlementUnconfirmed: 2,
  });

  drainOutcome = "throws";
  expect((await processExpiredSessions()).recovery).toEqual({
    ...counted,
    deliveries: 2,
    accepted: 0,
    partial: 2,
    settlementUnconfirmed: 0,
  });
});

test("a failed or malformed claim throws a sanitized error instead of an empty pass", async () => {
  claimResult = {
    data: null,
    error: { code: "57014", message: "private upstream detail" } as never,
  };
  await expect(processExpiredSessions()).rejects.toThrow(
    "Eligible signup query unavailable",
  );
  expect(recoveryCalls()).toHaveLength(0);
  expect(drained).toHaveLength(0);

  for (const malformed of [
    null,
    [],
    { contended: false, counted: true, sessions: [], heldSessions: noHeld },
    claim({ heldSessions: { ...noHeld, historical: -1 } }).data,
    claim({ sessions: Array.from({ length: 11 }, () => session(1)) }).data,
    claim({ sessions: [{ ...session(1), creatorId: null }] }).data,
    claim({
      sessions: [{ ...session(1), entries: [{ signupId: "missing-times" }] }],
    }).data,
  ]) {
    claimResult = { data: malformed, error: null };
    await expect(processExpiredSessions()).rejects.toThrow(
      "Eligible signup query returned an invalid claim",
    );
  }
  expect(publicationInputs).toHaveLength(0);
});

test("26 due deliveries with 25 accepted is a partial pass with one still pending", async () => {
  recoveryResult = {
    data: [
      recoveryGroup(Array.from({ length: 25 }, (_, index) => `due-${index}`)),
    ],
    error: null,
  };
  recoveryPending = 1;

  const result = await processExpiredSessions();

  expect(result.recovery).toEqual({
    counted: true,
    pending: 1,
    held: 0,
    deliveries: 25,
    accepted: 25,
    partial: 0,
    settlementUnconfirmed: 0,
  });
  expect(
    classifyWorkerResponse("auto-publish-hours", 200, { ...result }),
  ).toMatchObject({ outcome: "partial", completed: 25, pending: 1 });
});

test("leased, cooling, and held deliveries are reported without any send", async () => {
  // Nothing is selectable: three deliveries are leased or cooling down and
  // two are held (an unknown outcome and a corrected unfrozen original).
  recoveryPending = 3;
  recoveryHeld = 2;

  const result = await processExpiredSessions();

  expect(drained).toHaveLength(0);
  expect(result.recovery).toEqual({
    counted: true,
    pending: 3,
    held: 2,
    deliveries: 0,
    accepted: 0,
    partial: 0,
    settlementUnconfirmed: 0,
  });
  expect(
    classifyWorkerResponse("auto-publish-hours", 200, { ...result }),
  ).toMatchObject({
    outcome: "partial",
    attempted: 0,
    completed: 0,
    pending: 3,
    refused: 2,
  });
});

test("missing approval leaves discovery uncounted while the ledger is still counted and recovered", async () => {
  delete process.env.AUTO_PUBLISH_APPROVED_FROM;
  recoveryResult = { data: [recoveryGroup(["committed-1"])], error: null };
  recoveryHeld = 1;

  const result = await processExpiredSessions();

  expect(result.discoveryCounted).toBe(false);
  expect(result.heldSessions).toBeNull();
  expect(Object.hasOwn(result, "pendingSessions")).toBe(false);
  expect(result.recovery).toMatchObject({
    counted: true,
    pending: 0,
    held: 1,
    deliveries: 1,
    accepted: 1,
  });
  expect(drained).toHaveLength(1);
});

test("a failed or malformed recovery claim throws a sanitized error", async () => {
  recoveryResult = {
    data: null,
    error: { code: "57014", message: "private upstream detail" } as never,
  };
  await expect(processExpiredSessions()).rejects.toThrow(
    "Publication email recovery query unavailable",
  );

  const envelope = {
    counted: true,
    pendingDeliveries: 0,
    heldDeliveries: 0,
    groups: [],
  };
  for (const malformed of [
    null,
    { deliveries: [] },
    [{ projectId: "fictional-project", publication: null }],
    [
      recoveryGroup(
        Array.from({ length: 26 }, (_, index) => `overflow-${index}`),
      ),
    ],
    // 26 deliveries spread over single-delivery groups is still over the bound.
    Array.from({ length: 26 }, (_, index) =>
      recoveryGroup([`spread-${index}`], `receipt-${index}`),
    ),
    [recoveryGroup([])],
    // The inventory counts are part of the claim. None may be missing,
    // null, negative, fractional, or textual, and a bare list is refused.
    { ...envelope, counted: false },
    { ...envelope, pendingDeliveries: null },
    { ...envelope, pendingDeliveries: -1 },
    { ...envelope, heldDeliveries: 0.5 },
    { ...envelope, heldDeliveries: "0" },
    { counted: true, groups: [] },
    { ...envelope, groups: null },
  ]) {
    recoveryResult = { data: malformed, error: null };
    await expect(processExpiredSessions()).rejects.toThrow(
      "Publication email recovery returned an invalid claim",
    );
  }
  expect(drained).toHaveLength(0);
});
