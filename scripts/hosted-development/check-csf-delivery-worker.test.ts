import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  checkDeliveryWorker,
  validateTestQueue,
} from "./check-csf-delivery-worker.mjs";

const sha = "a".repeat(40);
const campaignId = "11111111-1111-4111-8111-111111111111";
const organizationId = "c5f11000-0000-4000-8000-000000000001";
const env = {
  ACCEPTED_SHA: sha,
  CSF_DELIVERY_CHECK_MODE: "verify-disabled",
  CSF_DELIVERY_CONFIRMATION: "verify-disabled:ocbuygudvarsuxijxhau",
  SUPABASE_URL: "https://ocbuygudvarsuxijxhau.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fictional-database-key",
  CSF_COMMUNICATIONS_WORKER_SECRET_TOKEN: "fictional-worker-key",
  VERCEL_AUTOMATION_BYPASS_SECRET: "fictional-bypass-key",
};
test("the manual workflow separates Development from the Production job", () => {
  const workflow = readFileSync(
    new URL(
      "../../.github/workflows/csf-communications-dispatch.yml",
      import.meta.url,
    ),
    "utf8",
  );
  expect(workflow).toContain(
    "github.ref == 'refs/heads/development' && inputs.target == 'development'",
  );
  expect(workflow).toContain(
    "github.ref == 'refs/heads/main' && inputs.target != 'development'",
  );
  expect(workflow).toContain("environment: development");
  expect(workflow).toContain("secrets.CSF_COMMUNICATIONS_WORKER_SECRET_TOKEN");
});
function queue() {
  const recipients = Array.from({ length: 10 }, (_, index) => ({
    id: `recipient-${index}`,
    campaign_id: campaignId,
    organization_id: organizationId,
    normalized_recipient_email: `delivered+csf-sep07-${String(index + 1).padStart(2, "0")}@resend.dev`,
    subscription_decision: "included",
  }));
  return {
    campaignId,
    campaigns: [
      { id: campaignId, organization_id: organizationId, status: "queued" },
    ],
    recipients,
    attempts: recipients.map((row) => ({
      campaign_id: campaignId,
      organization_id: organizationId,
      recipient_snapshot_id: row.id,
      state: "queued",
      attempt_number: 1,
      provider_message_id: null,
      dispatch_authorized_at: null,
    })),
  };
}
test("only the exact test audience and ten untouched attempts pass", () => {
  expect(() => validateTestQueue(queue())).not.toThrow();
  for (const mutate of [
    (value: ReturnType<typeof queue>) => {
      value.recipients[0].normalized_recipient_email = "student@example.test";
    },
    (value: ReturnType<typeof queue>) => {
      value.recipients[0].normalized_recipient_email =
        value.recipients[1].normalized_recipient_email;
    },
    (value: ReturnType<typeof queue>) => {
      value.recipients.pop();
    },
    (value: ReturnType<typeof queue>) => {
      value.attempts[0].state = "processing";
    },
    (value: ReturnType<typeof queue>) => {
      value.attempts[0].attempt_number = 2;
    },
    (value: ReturnType<typeof queue>) => {
      value.attempts[0].campaign_id = "other";
    },
    (value: ReturnType<typeof queue>) => {
      value.campaigns.push({ ...value.campaigns[0], id: "other" });
    },
    (value: ReturnType<typeof queue>) => {
      value.attempts.push(value.attempts[0]);
    },
  ]) {
    const value = queue();
    mutate(value);
    expect(() => validateTestQueue(value)).toThrow();
  }
});
function responses(enabled = false) {
  return [
    { service: "lets-assist", environment: "preview", version: sha },
    {
      releaseSha: sha,
      workers: {
        workbook_refresh: false,
        import_commit: false,
        scheduled_post_publisher: false,
        communications: enabled,
      },
    },
  ];
}
test("Production and mismatched confirmation fail before any network request", async () => {
  for (const overrides of [
    { SUPABASE_URL: "https://fotdmeakexgrkronxlof.supabase.co" },
    { CSF_DELIVERY_CONFIRMATION: "wrong" },
    { ACCEPTED_SHA: "short" },
    { CSF_COMMUNICATIONS_WORKER_SECRET_TOKEN: "" },
  ]) {
    let calls = 0;
    await expect(
      checkDeliveryWorker({ ...env, ...overrides }, async () => {
        calls++;
        return Response.json({});
      }),
    ).rejects.toThrow();
    expect(calls).toBe(0);
  }
});
test("a disabled check refuses enabled controls before calling the worker", async () => {
  const payloads = responses(true);
  let calls = 0;
  await expect(
    checkDeliveryWorker(env, async () => {
      calls++;
      return Response.json(payloads.shift());
    }),
  ).rejects.toThrow("worker controls");
  expect(calls).toBe(2);
});
test("disabled authentication returns only count fields and never retries", async () => {
  const payloads: unknown[] = [
    ...responses(),
    { enabled: false, claimed: 0, faults: 0, secret: "private" },
  ];
  let calls = 0;
  const result = await checkDeliveryWorker(env, async (_url, options) => {
    calls++;
    expect(options.redirect).toBe("error");
    return Response.json(payloads.shift());
  });
  expect(calls).toBe(3);
  expect(result).toEqual({
    mode: "verify-disabled",
    authenticated: true,
    enabled: false,
    claimed: 0,
    faults: 0,
  });
  calls = 0;
  await expect(
    checkDeliveryWorker(env, async () => {
      calls++;
      throw new Error("transport");
    }),
  ).rejects.toThrow();
  expect(calls).toBe(1);
});
test("a dispatch checks the whole active queue before exactly one worker call", async () => {
  const value = queue();
  const payloads: unknown[] = [
    ...responses(true),
    value.campaigns,
    value.recipients,
    value.attempts,
    { enabled: true, claimed: 10, faults: 0 },
  ];
  const calls: string[] = [];
  const result = await checkDeliveryWorker(
    {
      ...env,
      CSF_DELIVERY_CHECK_MODE: "dispatch-test",
      CSF_DELIVERY_CONFIRMATION: "dispatch-test:ocbuygudvarsuxijxhau",
      CSF_TEST_CAMPAIGN_ID: campaignId,
    },
    async (url) => {
      calls.push(url);
      return Response.json(payloads.shift());
    },
  );
  expect(result.claimed).toBe(10);
  expect(calls.filter((url) => url.includes("/api/cron/"))).toHaveLength(1);
  expect(calls[2]).toContain("status=in.(queued,sending)");
  expect(calls[4]).toContain("state.in.(queued,processing)");
});
