import { beforeEach, expect, mock, test } from "bun:test";

// The real issuance helper and the real replay-safe RPC transport run here.
// Only the database client, the ledger drain, and the provider are replaced.
mock.module("server-only", () => ({}));
mock.module("@/emails/certificate-published", () => ({ default: () => null }));
const directSends: unknown[] = [];
mock.module("@/services/email", () => ({
  async sendEmail(input: unknown) {
    directSends.push(input);
    throw new Error("Supplemental issuance must never send directly");
  },
}));

type RpcResult = { data: unknown; error: { code?: string } | null };
const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
let rpcResponses: Array<RpcResult | Error> = [];
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from() {
      throw new Error("Supplemental issuance must not write tables directly");
    },
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      const next = rpcResponses.shift();
      if (!next) throw new Error("Unexpected extra RPC attempt");
      if (next instanceof Error) throw next;
      return next;
    },
  }),
}));

type Delivery = { deliveryId: string; state: string; certificateId: string };
const drained: Delivery[][] = [];
let drainErrors: string[] = [];
mock.module("@/lib/projects/hours-publication-email-service", () => ({
  async drainPublicationEmails(publication: { deliveries: Delivery[] }) {
    drained.push(publication.deliveries);
    const pending = publication.deliveries.filter((row) =>
      ["queued", "retryable_failure"].includes(row.state),
    ).length;
    return {
      emailsSent: pending,
      errors: drainErrors,
      partial: drainErrors.length > 0,
      settledAccepted: pending,
      settlementUnconfirmed: 0,
    };
  },
}));

const { issueCertificatesForSignups } = await import("./certificate-issuance");

const request = {
  projectId: "fictional-project",
  scheduleId: "oneTime",
  signupIds: ["signup-a", "signup-b", "signup-a"],
  actorId: "fictional-organizer",
};
function delivery(id: string, state = "queued"): Delivery {
  return {
    deliveryId: `delivery-${id}`,
    state,
    certificateId: `certificate-${id}`,
  };
}
function recovered(
  issued: number,
  deliveries: Delivery[] | null,
  recoveryRequired = false,
): RpcResult {
  return {
    data: {
      issued,
      recoveryRequired,
      publication: deliveries && {
        outcome: "replayed",
        receiptId: "fictional-receipt",
        requestKey: "fictional-request",
        certificatesCreated: deliveries.length,
        projectTitle: "Fictional cleanup",
        projectTimezone: "UTC",
        publicationOrigin: "manual",
        deliveries,
      },
    },
    error: null,
  };
}

beforeEach(() => {
  rpcCalls.length = 0;
  rpcResponses = [];
  drained.length = 0;
  drainErrors = [];
  directSends.length = 0;
});

test("new awards and their email work commit in one RPC and drain through the ledger", async () => {
  rpcResponses = [recovered(2, [delivery("a"), delivery("b")])];

  expect(await issueCertificatesForSignups(request)).toEqual({
    issued: 2,
    emailsSent: 2,
    errors: [],
    deliveryDurable: true,
  });
  expect(rpcCalls).toEqual([
    {
      name: "recover_supplemental_verified_certificates",
      args: {
        p_project_id: "fictional-project",
        p_schedule_id: "oneTime",
        p_signup_ids: ["signup-a", "signup-b"],
        p_actor_id: "fictional-organizer",
      },
    },
  ]);
  expect(drained).toEqual([[delivery("a"), delivery("b")]]);
  expect(directSends).toHaveLength(0);
});

test("a lost response replays the same request and drains the already-tracked awards", async () => {
  // The first call committed, but its response never arrived. The replay
  // issues nothing and returns the first call's deliveries.
  rpcResponses = [
    Object.assign(new Error("synthetic lost response"), { code: "PGRST000" }),
    recovered(0, [delivery("a"), delivery("b")]),
  ];

  expect(await issueCertificatesForSignups(request)).toEqual({
    issued: 0,
    emailsSent: 2,
    errors: [],
    deliveryDurable: true,
  });
  expect(rpcCalls).toHaveLength(2);
  expect(rpcCalls[1]).toEqual(rpcCalls[0]);
  expect(drained).toEqual([[delivery("a"), delivery("b")]]);
  expect(directSends).toHaveLength(0);
});

test("a replay over unknown and accepted deliveries issues and sends nothing new", async () => {
  rpcResponses = [
    recovered(0, [delivery("a", "unknown_outcome"), delivery("b", "accepted")]),
  ];
  drainErrors = ["Certificate certificate-a: email unknown outcome"];

  expect(await issueCertificatesForSignups(request)).toEqual({
    issued: 0,
    emailsSent: 0,
    errors: ["Certificate certificate-a: email unknown outcome"],
    deliveryDurable: true,
  });
  expect(rpcCalls).toHaveLength(1);
  expect(directSends).toHaveLength(0);
});

test("a historical award without a ledger is reported for review and never sent", async () => {
  rpcResponses = [recovered(0, null, true)];
  expect(await issueCertificatesForSignups(request)).toEqual({
    issued: 0,
    emailsSent: 0,
    errors: ["certificate_delivery_review_required"],
    deliveryDurable: false,
  });
  expect(drained).toHaveLength(0);

  // A new award beside an untracked one still drains only its own delivery.
  rpcResponses = [recovered(1, [delivery("b")], true)];
  expect(await issueCertificatesForSignups(request)).toEqual({
    issued: 1,
    emailsSent: 1,
    errors: ["certificate_delivery_review_required"],
    deliveryDurable: false,
  });
  expect(drained).toEqual([[delivery("b")]]);
  expect(directSends).toHaveLength(0);
});

test("a receipt with no requested delivery is not reported as durable", async () => {
  rpcResponses = [recovered(0, [])];
  expect(await issueCertificatesForSignups(request)).toMatchObject({
    issued: 0,
    errors: [],
    deliveryDurable: false,
  });
});

test("a database rejection or malformed response fails closed with a bounded code", async () => {
  rpcResponses = [
    { data: null, error: { code: "42501" } },
    { data: null, error: { code: "42501" } },
  ];
  expect(await issueCertificatesForSignups(request)).toEqual({
    issued: 0,
    emailsSent: 0,
    errors: ["certificate_insert_failed:42501"],
    deliveryDurable: false,
  });

  rpcResponses = [
    { data: { issued: 1 }, error: null },
    { data: { issued: 1 }, error: null },
  ];
  expect(await issueCertificatesForSignups(request)).toEqual({
    issued: 0,
    emailsSent: 0,
    errors: ["certificate_recovery_invalid_response"],
    deliveryDurable: false,
  });
  expect(drained).toHaveLength(0);
  expect(directSends).toHaveLength(0);
});

test("empty and oversized requests never reach the database", async () => {
  expect(
    await issueCertificatesForSignups({ ...request, signupIds: [] }),
  ).toEqual({ issued: 0, emailsSent: 0, errors: [], deliveryDurable: false });
  expect(
    await issueCertificatesForSignups({
      ...request,
      signupIds: Array.from({ length: 501 }, (_, index) => `signup-${index}`),
    }),
  ).toEqual({
    issued: 0,
    emailsSent: 0,
    errors: ["too_many_signups"],
    deliveryDurable: false,
  });
  expect(rpcCalls).toHaveLength(0);
});
