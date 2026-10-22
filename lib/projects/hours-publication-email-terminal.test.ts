import { beforeEach, expect, mock, test } from "bun:test";
import type { TransactionalPublication } from "./hours-publication-service";

mock.module("server-only", () => ({}));
mock.module("@/emails/certificate-published", () => ({ default: () => null }));
mock.module("react-email", () => ({
  render: () => {
    throw new Error("Prepared recovery must never render today's template");
  },
}));
mock.module("@/lib/logger", () => ({ logError() {} }));
mock.module("@/services/email-sender-identity", () => ({
  resolvePlatformSenderHeader: () => {
    throw new Error("Prepared recovery must never choose today's sender");
  },
}));
const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
const sends: Array<Record<string, unknown>> = [];
let claimed = true;
let settles = true;
let dispatchThrows = false;
const snapshot = {
  version: 1,
  to: "approved-original@example.test",
  from: "Original <original@example.test>",
  subject: "Original manual publication",
  html: "<p>Original approved content</p>",
  tags: [
    { name: "workflow", value: "volunteer-hours-publication" },
    { name: "receipt", value: "fictional-receipt" },
  ],
};
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (name === "prepare_hours_publication_email_delivery")
        return { data: snapshot, error: null };
      if (name === "claim_hours_publication_email_delivery")
        return { data: claimed, error: null };
      if (name === "settle_hours_publication_email_delivery")
        return { data: settles, error: null };
      throw new Error("Unexpected RPC");
    },
  }),
}));
mock.module("@/services/email", () => ({
  async sendEmail(input: Record<string, unknown>) {
    sends.push(input);
    if (dispatchThrows) throw new Error("Synthetic ambiguous transport");
    return { outcome: "accepted", messageId: "fictional-provider-id" };
  },
}));
const { drainPublicationEmails } =
  await import("./hours-publication-email-service");
beforeEach(() => {
  calls.length = 0;
  sends.length = 0;
  claimed = true;
  settles = true;
  dispatchThrows = false;
});
function publication(state = "retryable_failure"): TransactionalPublication {
  return {
    outcome: "replayed",
    receiptId: "fictional-receipt",
    requestKey: "original-request",
    certificatesCreated: 1,
    projectTitle: "Today's changed title",
    projectTimezone: "UTC",
    publicationOrigin: "manual",
    deliveries: [
      {
        deliveryId: "fictional-delivery",
        state,
        payloadPrepared: true,
        idempotencyKey: "original-key",
        certificateId: "fictional-certificate",
        volunteerName: "Changed Name",
        volunteerEmail: "changed@example.test",
        eventStart: "2026-01-01T10:00:00Z",
        eventEnd: "2026-01-01T11:00:00Z",
      },
    ],
  };
}

test("accepted and unknown deliveries never acquire a claim or send again", async () => {
  expect(await drainPublicationEmails(publication("accepted"))).toMatchObject({
    emailsSent: 1,
    partial: false,
  });
  expect(
    await drainPublicationEmails(publication("unknown_outcome")),
  ).toMatchObject({ emailsSent: 0, partial: true });
  expect(calls).toHaveLength(0);
  expect(sends).toHaveLength(0);
});
test("recovery sends only the immutable original payload and original key", async () => {
  expect(await drainPublicationEmails(publication())).toMatchObject({
    emailsSent: 1,
    partial: false,
  });
  expect(calls[0].args).toMatchObject({
    p_sender: null,
    p_subject: null,
    p_html: null,
  });
  expect(sends).toHaveLength(1);
  expect(sends[0]).toMatchObject({
    to: snapshot.to,
    from: snapshot.from,
    subject: snapshot.subject,
    html: snapshot.html,
    idempotencyKey: "original-key",
  });
});
test("a refused or expired database claim never dispatches a provider request", async () => {
  claimed = false;
  expect(await drainPublicationEmails(publication())).toMatchObject({
    emailsSent: 0,
    partial: true,
  });
  expect(sends).toHaveLength(0);
  expect(calls.map((call) => call.name)).toEqual([
    "prepare_hours_publication_email_delivery",
    "claim_hours_publication_email_delivery",
  ]);
});
test("every terminal ledger state is left untouched by a drain", async () => {
  for (const state of ["skipped", "definitive_failure", "unknown_outcome"]) {
    expect(await drainPublicationEmails(publication(state))).toMatchObject({
      emailsSent: 0,
      partial: true,
      settledAccepted: 0,
      settlementUnconfirmed: 0,
    });
  }
  expect(calls).toHaveLength(0);
  expect(sends).toHaveLength(0);
});
test("acceptance counts as settled only after the ledger records it", async () => {
  expect(await drainPublicationEmails(publication())).toMatchObject({
    settledAccepted: 1,
    settlementUnconfirmed: 0,
    partial: false,
  });

  settles = false;
  const unconfirmed = await drainPublicationEmails(publication());
  expect(unconfirmed).toMatchObject({
    settledAccepted: 0,
    settlementUnconfirmed: 1,
    partial: true,
  });
  expect(unconfirmed.errors).toEqual([
    "Certificate fictional-certificate: delivery settlement failed",
  ]);
  // One provider request per drain. The unconfirmed write is retried against
  // the ledger only, never by sending again.
  expect(sends).toHaveLength(2);
  expect(
    calls.filter((call) => call.name.startsWith("settle_")).length,
  ).toBeGreaterThan(2);
});
test("ambiguous provider exceptions settle as unknown rather than retryable", async () => {
  dispatchThrows = true;
  expect(await drainPublicationEmails(publication())).toMatchObject({
    emailsSent: 0,
    partial: true,
  });
  expect(sends).toHaveLength(1);
  expect(calls.at(-1)).toMatchObject({
    name: "settle_hours_publication_email_delivery",
    args: {
      p_state: "unknown_outcome",
      p_provider_message_id: null,
      p_safe_code: "unhandled_dispatch_error",
    },
  });
});
