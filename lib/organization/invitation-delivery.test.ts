import { expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SendEmailParams, SendEmailResult } from "@/services/email";
import { deliverInvitation } from "./invitation-delivery";
const id = "11111111-1111-4111-8111-111111111111";
const email: SendEmailParams = {
  to: "synthetic@example.test",
  subject: "Synthetic invite",
  text: "Synthetic body",
  type: "transactional",
};
const accepted: SendEmailResult = {
  outcome: "accepted",
  success: true,
  skipped: false,
  phase: "provider_response",
  messageId: "synthetic-message",
  transport: "resend",
  data: { id: "synthetic-message" },
};
function harness(
  options: {
    failClaim?: boolean;
    failSettle?: boolean;
    previous?: string;
  } = {},
) {
  const row: Record<string, unknown> = {
    id,
    status: "pending",
    email_delivery_status: options.previous ? "sent" : "pending",
    last_email_attempt_at: options.previous ?? null,
  };
  const writes: Record<string, unknown>[] = [];
  const client = {
    from: () => ({
      update: (values: Record<string, unknown>) => {
        const filters: Array<[string, unknown]> = [];
        const query = {
          eq: (key: string, value: unknown) => {
            filters.push([key, value]);
            return query;
          },
          is: (key: string, value: unknown) => {
            filters.push([key, value]);
            return query;
          },
          select: () => query,
          maybeSingle: async () => {
            const fail =
              writes.length === 0 ? options.failClaim : options.failSettle;
            writes.push(values);
            if (fail)
              return {
                data: null,
                error: { message: "Synthetic database fault" },
              };
            if (!filters.every(([key, value]) => row[key] === value))
              return { data: null, error: null };
            Object.assign(row, values);
            return { data: { id }, error: null };
          },
        };
        return query;
      },
    }),
  } as unknown as SupabaseClient;
  return { row, writes, client };
}

test("claims durable intent before sending and records only provider acceptance as sent", async () => {
  const h = harness();
  let key: string | undefined;
  const result = await deliverInvitation({
    supabase: h.client,
    invitationId: id,
    email,
    dispatch: async (params) => {
      expect(h.row.email_delivery_status).toBe("pending");
      expect(h.row.last_email_attempt_at).toBeString();
      expect(h.writes).toHaveLength(1);
      key = params.idempotencyKey;
      return accepted;
    },
  });
  expect(result.success).toBe(true);
  expect(key).toBe(
    `organization-invitation/${id}/${h.row.last_email_attempt_at}`,
  );
  expect(h.row.email_delivery_status).toBe("sent");
  expect(h.row.email_message_id).toBe("synthetic-message");
});

for (const outcome of [
  "skipped",
  "definitive_failure",
  "retryable_pre_send",
  "unknown_outcome",
] as const)
  test(`${outcome} never counts as a successful invitation email`, async () => {
    const h = harness();
    const result = await deliverInvitation({
      supabase: h.client,
      invitationId: id,
      email,
      dispatch: async (): Promise<SendEmailResult> =>
        outcome === "skipped"
          ? {
              outcome,
              success: false,
              skipped: true,
              phase: "transport_setup",
              reason: "Synthetic reason",
              code: "synthetic",
            }
          : {
              outcome,
              success: false,
              skipped: false,
              phase: "provider_request",
              error: "Synthetic provider failure",
              code: "synthetic",
              status: null,
            },
    });
    expect(result.success).toBe(false);
    expect(h.row.last_email_sent_at).toBeNull();
    expect(h.row.email_delivery_status).toBe(
      outcome === "unknown_outcome"
        ? "pending"
        : outcome === "skipped"
          ? "skipped"
          : "failed",
    );
  });

test("an uncertain attempt prevents a new resend even after process restart", async () => {
  const h = harness();
  let sends = 0;
  await deliverInvitation({
    supabase: h.client,
    invitationId: id,
    email,
    dispatch: async () => {
      sends++;
      throw new Error("Synthetic provider timeout");
    },
  });
  const result = await deliverInvitation({
    supabase: h.client,
    invitationId: id,
    email,
    previousAttempt: h.row.last_email_attempt_at as string,
    previousDelivery: "pending",
    dispatch: async () => {
      sends++;
      return accepted;
    },
  });
  expect(result.success).toBe(false);
  expect(sends).toBe(1);
  expect(h.writes).toHaveLength(1);
});

test("two concurrent resend requests can claim only one provider attempt", async () => {
  const previous = "2026-01-01T00:00:00.000Z";
  const h = harness({ previous });
  let sends = 0;
  const options = {
    supabase: h.client,
    invitationId: id,
    email,
    previousAttempt: previous,
    previousDelivery: "sent" as const,
    dispatch: async () => {
      sends++;
      return accepted;
    },
  };
  const results = await Promise.all([
    deliverInvitation(options),
    deliverInvitation(options),
  ]);
  expect(sends).toBe(1);
  expect(results.filter((result) => result.success)).toHaveLength(1);
});

test("a refused claim makes zero provider requests", async () => {
  const h = harness({ failClaim: true });
  let sends = 0;
  const result = await deliverInvitation({
    supabase: h.client,
    invitationId: id,
    email,
    dispatch: async () => {
      sends++;
      return accepted;
    },
  });
  expect(result.success).toBe(false);
  expect(sends).toBe(0);
});

test("a lost settlement is reported as unknown and leaves the durable pending fence", async () => {
  const h = harness({ failSettle: true });
  const result = await deliverInvitation({
    supabase: h.client,
    invitationId: id,
    email,
    dispatch: async () => accepted,
  });
  expect(result.success).toBe(false);
  expect(h.row.email_delivery_status).toBe("pending");
  expect(h.row.last_email_attempt_at).toBeString();
});

test("acceptance or cancellation racing the send claim prevents any provider request", async () => {
  for (const status of ["accepted", "cancelled"]) {
    const h = harness();
    h.row.status = status;
    let sends = 0;
    expect(
      (
        await deliverInvitation({
          supabase: h.client,
          invitationId: id,
          email,
          dispatch: async () => {
            sends++;
            return accepted;
          },
        })
      ).success,
    ).toBe(false);
    expect(sends).toBe(0);
  }
});
