import { beforeEach, expect, mock, test } from "bun:test";
import type { TransactionalPublication } from "./hours-publication-service";

// The email prefix follows the receipt's recorded origin and nothing else.
// A manual receipt that an automatic request replays must stay unprefixed.
mock.module("server-only", () => ({}));
mock.module("@/emails/certificate-published", () => ({ default: () => null }));
const rendered: Array<{ isAutoPublished: unknown }> = [];
mock.module("react-email", () => ({
  render: async (element: { props: { isAutoPublished: unknown } }) => {
    rendered.push({ isAutoPublished: element.props.isAutoPublished });
    return "<p>fictional certificate</p>";
  },
}));
mock.module("@/lib/logger", () => ({ logError() {} }));
mock.module("@/services/email-sender-identity", () => ({
  resolvePlatformSenderHeader: () => "Fictional <fictional@example.test>",
}));
const prepared: Array<Record<string, unknown>> = [];
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    async rpc(name: string, args: Record<string, unknown>) {
      if (name === "prepare_hours_publication_email_delivery") {
        prepared.push(args);
        return {
          data: {
            version: 1,
            to: "volunteer@example.test",
            from: args.p_sender,
            subject: args.p_subject,
            html: args.p_html,
            tags: [
              { name: "workflow", value: "volunteer-hours-publication" },
              { name: "receipt", value: "fictional-receipt" },
            ],
          },
          error: null,
        };
      }
      return { data: true, error: null };
    },
  }),
}));
const sends: Array<Record<string, unknown>> = [];
mock.module("@/services/email", () => ({
  async sendEmail(input: Record<string, unknown>) {
    sends.push(input);
    return { outcome: "accepted", messageId: "fictional-provider-id" };
  },
}));
const { drainPublicationEmails } =
  await import("./hours-publication-email-service");

beforeEach(() => {
  rendered.length = 0;
  prepared.length = 0;
  sends.length = 0;
});
function publication(
  publicationOrigin: "manual" | "automatic",
): TransactionalPublication {
  return {
    outcome: "replayed",
    receiptId: "fictional-receipt",
    requestKey: "fictional-request",
    certificatesCreated: 1,
    projectTitle: "Fictional cleanup",
    projectTimezone: "UTC",
    publicationOrigin,
    deliveries: [
      {
        deliveryId: "fictional-delivery",
        state: "queued",
        payloadPrepared: false,
        idempotencyKey: "hours-publication:v1:certificate:fictional",
        certificateId: "fictional-certificate",
        volunteerName: "Fictional Volunteer",
        volunteerEmail: "volunteer@example.test",
        eventStart: "2026-01-01T10:00:00Z",
        eventEnd: "2026-01-01T11:00:00Z",
      },
    ],
  };
}

test("a manual receipt recovered by the automatic worker keeps its unprefixed subject", async () => {
  await drainPublicationEmails(publication("manual"));

  expect(prepared[0].p_subject).toBe(
    "Your volunteer certificate for Fictional cleanup is ready!",
  );
  expect(rendered).toEqual([{ isAutoPublished: false }]);
  expect(sends[0].subject).toBe(prepared[0].p_subject);
});

test("only a receipt recorded as automatic carries the auto-published prefix", async () => {
  await drainPublicationEmails(publication("automatic"));

  expect(prepared[0].p_subject).toBe(
    "[Auto-Published] Your volunteer certificate for Fictional cleanup is ready!",
  );
  expect(rendered).toEqual([{ isAutoPublished: true }]);
});
