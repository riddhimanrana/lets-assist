import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * The one Resend outcome that decides whether a retry mails a real person twice.
 *
 * `concurrent_idempotent_requests` does NOT mean "we refused you, try later". Resend
 * returns it when ANOTHER REQUEST CARRYING THE SAME IDEMPOTENCY KEY IS CURRENTLY IN
 * PROGRESS. The in-flight request may be accepted a millisecond later, and this
 * caller has no way to observe that. It is therefore an unknown outcome, not a
 * pre-send refusal.
 *
 * Classifying it as throttled was a duplicate-send generator, and the path was
 * fully mechanical:
 *
 *   throttled -> retryable_pre_send (services/email.ts)
 *             -> retryable_failure  (mapTransportResultToSettlement)
 *             -> the ledger inserts a SUCCESSOR attempt
 *             -> the enqueue trigger allocates a key from attempt_number + 1
 *
 * The successor's provider idempotency key is DIFFERENT from the one already in
 * flight, so Resend's own deduplication cannot catch it either. The concurrent
 * request lands, the successor lands, and the recipient is mailed twice.
 *
 * Every fixture here is synthetic and uses reserved .test names.
 */

type MockResendResponse = {
  data: { id: string } | null;
  error: { name: string; message: string; statusCode?: number | null } | null;
};

const resendSend = mock(async (): Promise<MockResendResponse> => ({
  data: { id: "provider-message-id" },
  error: null,
}));

mock.module("resend", () => ({
  Resend: class {
    readonly emails = { send: resendSend };
  },
}));
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => {
    throw new Error("notification settings must not be queried in these tests");
  },
}));
mock.module("react-email", () => ({
  render: async () => "<p>x</p>",
}));
mock.module("@/lib/logger", () => ({
  logError: () => undefined,
  logInfo: () => undefined,
  logWarn: () => undefined,
}));

const { classifyProviderError, sendEmail } = await import("./email");

beforeEach(() => {
  resendSend.mockClear();
  resendSend.mockImplementation(async () => ({
    data: { id: "provider-message-id" },
    error: null,
  }));
  process.env.EMAIL_TRANSPORT = "resend";
  process.env.RESEND_API_KEY = "synthetic-resend-key";
});

/**
 * Read the classification table out of the module source.
 *
 * Behavioural assertions alone cannot catch the mutation that matters. Moving
 * `concurrent_idempotent_requests` back among the throttled entries is a one-line
 * edit, and a test that only exercised the codes it already knew about would keep
 * passing for every OTHER code. Parsing the table lets the test assert on the
 * mapping itself, and then re-derive the behaviour from it, so the source and the
 * runtime cannot drift apart silently.
 */
function providerErrorClassificationTable(): Map<string, string> {
  const source = readFileSync(new URL("./email.ts", import.meta.url), "utf8");
  const block = source.match(
    /const PROVIDER_ERROR_CLASSIFICATION[^=]*=\s*\{([\s\S]*?)\n\};/,
  );
  if (!block) {
    throw new Error(
      "PROVIDER_ERROR_CLASSIFICATION could not be located in services/email.ts",
    );
  }

  const entries = new Map<string, string>();
  for (const match of block[1].matchAll(
    /^\s*([a-z0-9_]+)\s*:\s*["'](rejected|throttled|ambiguous)["']/gmu,
  )) {
    entries.set(match[1], match[2]);
  }
  return entries;
}

const EXPECTED_OUTCOME: Record<string, string> = {
  rejected: "definitive_failure",
  throttled: "retryable_pre_send",
  ambiguous: "unknown_outcome",
};

describe("Resend concurrent idempotency is an unknown outcome", () => {
  test("a concurrent idempotent request never classifies as retryable", () => {
    const result = classifyProviderError({
      name: "concurrent_idempotent_requests",
      statusCode: 409,
    });

    expect(result.outcome).toBe("unknown_outcome");
    // The exact mistake this guards. `retryable_pre_send` asserts "nothing was
    // sent", which is precisely what nobody can know while another request under
    // the same key is still in flight.
    expect(result.outcome).not.toBe("retryable_pre_send");
    expect(result.outcome).not.toBe("definitive_failure");
  });

  test("the provider code survives as bounded diagnostic evidence", () => {
    const result = classifyProviderError({
      name: "concurrent_idempotent_requests",
      statusCode: 409,
    });

    // An operator reconciling this by hand needs to know it was a concurrency
    // collision rather than a dead socket -- those get looked up differently in
    // the provider dashboard.
    expect(result.code).toBe("concurrent_idempotent_requests");
    expect(result.status).toBe(409);
    expect(String(result.error)).toContain("concurrent_idempotent_requests");
    // Bounded and PII-free: a closed-set code and a constructed sentence.
    expect(String(result.error).length).toBeLessThanOrEqual(200);
  });

  test("sendEmail makes exactly one provider call and reports it unknown", async () => {
    resendSend.mockImplementation(async () => ({
      data: null,
      error: {
        name: "concurrent_idempotent_requests",
        message:
          "Another request with the same idempotency key for student@example.test is in progress",
        statusCode: 409,
      },
    }));

    const result = await sendEmail({
      to: "student@example.test",
      subject: "Synthetic concurrent idempotency notice",
      text: "Body",
      type: "transactional",
      idempotencyKey: "csf-att-synthetic-1",
    });

    expect(result).toMatchObject({
      outcome: "unknown_outcome",
      success: false,
      skipped: false,
      phase: "provider_response",
      code: "concurrent_idempotent_requests",
      status: 409,
    });

    // No internal retry loop: the module sends once and reports what it saw.
    expect(resendSend).toHaveBeenCalledTimes(1);
    // The provider's own message named the recipient. The summary must not.
    expect(String(result.error)).not.toContain("student@example.test");
  });

  test("the classification table itself pins the code as ambiguous", () => {
    const table = providerErrorClassificationTable();

    // Guard the parse: an empty or tiny map would make every assertion below
    // vacuously true.
    expect(table.size).toBeGreaterThanOrEqual(15);
    expect(table.get("concurrent_idempotent_requests")).toBe("ambiguous");

    const throttled = [...table.entries()]
      .filter(([, kind]) => kind === "throttled")
      .map(([code]) => code);
    // Moving the code back into the retryable set fails here by name.
    expect(throttled).not.toContain("concurrent_idempotent_requests");
    // The genuinely pre-send capacity refusals are still classified as such, so
    // this test cannot be satisfied by declaring everything ambiguous.
    expect(throttled).toContain("rate_limit_exceeded");
    expect(throttled).toContain("daily_quota_exceeded");
  });

  test("every classified code produces the outcome its table entry claims", () => {
    const table = providerErrorClassificationTable();

    for (const [code, kind] of table) {
      const result = classifyProviderError({ name: code, statusCode: 400 });
      expect(`${code}=${result.outcome}`).toBe(
        `${code}=${EXPECTED_OUTCOME[kind]}`,
      );
    }
  });

  test("an in-flight duplicate is never a safe retry, whatever the status code", () => {
    // Resend has changed the status attached to this condition before. The
    // conclusion follows from the NAME, not the number.
    for (const statusCode of [409, 429, 422, 500]) {
      const result = classifyProviderError({
        name: "concurrent_idempotent_requests",
        statusCode,
      });
      expect(`${statusCode}=${result.outcome}`).toBe(
        `${statusCode}=unknown_outcome`,
      );
    }
  });
});

/**
 * THE OTHER DIRECTION OF THE SAME MISTAKE.
 *
 * Everything above is about never calling an ambiguous outcome retryable. This
 * is about never calling a PROVABLY PRE-SEND outcome ambiguous, which is just as
 * damaging in the CSF ledger and considerably quieter: `unknown_outcome` is
 * terminal there -- no transition back to queued or processing, no successor
 * attempt behind it -- so a recipient who was never mailed never will be, and an
 * officer has to reconcile a send that did not happen.
 *
 * The caller that hits this is the dispatch cron route. It arms an abort signal
 * with whatever time is left in its wall-clock budget, and the worker then makes
 * two database round trips -- claim, then authorize -- before the send. On a busy
 * invocation's last pass the signal can therefore fire before the request opens.
 */
describe("a cancellation observed before the provider request is pre-send", () => {
  test("an already-aborted signal is retryable, not unknown, and sends nothing", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await sendEmail({
      to: "student@example.test",
      subject: "Synthetic cancelled announcement",
      text: "Body",
      type: "transactional",
      idempotencyKey: "csf-att-synthetic-2",
      signal: controller.signal,
    });

    expect(result).toMatchObject({
      outcome: "retryable_pre_send",
      success: false,
      skipped: false,
      phase: "transport_setup",
      code: "request_cancelled_before_send",
    });
    // The point of the branch: the transport is never reached, so there is
    // nothing for the provider to have accepted.
    expect(resendSend).toHaveBeenCalledTimes(0);
    expect(String(result.error)).not.toContain("student@example.test");
  });

  test("the CSF ledger settlement follows: retryable, never a terminal unknown", async () => {
    const { mapTransportResultToSettlement } =
      await import("./csf-communications-dispatch");
    const controller = new AbortController();
    controller.abort();

    const settlement = mapTransportResultToSettlement(
      await sendEmail({
        to: "student@example.test",
        subject: "Synthetic cancelled announcement",
        text: "Body",
        type: "transactional",
        signal: controller.signal,
      }),
    );

    expect(settlement.outcome).toBe("retryable_failure");
    // A retryable settlement must carry no provider message identity: naming a
    // message would mean the request was accepted.
    expect(settlement.providerMessageId).toBeNull();
  });

  test("a live signal still reaches the provider", async () => {
    // Anti-tautology. Without this, deleting the send call entirely would leave
    // the assertions above passing.
    const controller = new AbortController();

    const result = await sendEmail({
      to: "student@example.test",
      subject: "Synthetic live announcement",
      text: "Body",
      type: "transactional",
      signal: controller.signal,
    });

    expect(result.outcome).toBe("accepted");
    expect(resendSend).toHaveBeenCalledTimes(1);
  });
});
