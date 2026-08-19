import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";

mock.module("server-only", () => ({}));

/**
 * Hermetic tests for the Resend webhook boundary.
 *
 * Nothing here reaches Resend or Supabase. The Resend SDK is replaced with a
 * stub whose verify() records the exact string it was handed, which is how the
 * signature-before-parse ordering and the exact-raw-body hash are proven.
 *
 * Every fixture value is synthetic.
 */

type VerifyCall = { payload: string; headers: Record<string, string> };

const verifyCalls: VerifyCall[] = [];
const constructedApiKeys: unknown[] = [];
let verifyImpl: (call: VerifyCall) => unknown = () => ({
  type: "email.sent",
  data: {},
});

mock.module("resend", () => ({
  Resend: class {
    constructor(apiKey?: string) {
      constructedApiKeys.push(apiKey);
    }

    webhooks = {
      verify: (call: VerifyCall) => {
        verifyCalls.push({
          payload: call.payload,
          headers: { ...call.headers },
        });
        return verifyImpl(call);
      },
    };
  },
}));

type RpcCall = { fn: string; args: Record<string, unknown> };
type RpcOutcome = {
  data: unknown;
  error: { message: string; code?: string } | null;
};
const rpcCalls: RpcCall[] = [];
let rpcResult: RpcOutcome = {
  data: {
    duplicate: false,
    processingState: "reduced",
    reductionApplied: true,
  },
  error: null,
};
/** The quarantine RPC answers separately, so a ledger outage and a quarantine
 * outage can be exercised independently. */
let quarantineResult: RpcOutcome = {
  data: { quarantineId: "q-default", occurrenceCount: 1, firstCapture: true },
  error: null,
};

mock.module("@/lib/plugins/supabase", () => ({
  createPluginAdminClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (fn === "csf_quarantine_communication_webhook") {
        const eventId = args.p_provider_event_id;
        const messageId = args.p_provider_message_id;
        if (
          typeof eventId !== "string" ||
          eventId.length > 255 ||
          /\s/u.test(eventId) ||
          (typeof messageId === "string" && messageId.length > 255)
        ) {
          return {
            data: null,
            error: {
              code: "22023",
              message: "synthetic quarantine coordinate constraint failure",
            },
          };
        }
        return quarantineResult;
      }
      return rpcResult;
    },
  }),
}));

const route = await import("./implementation");
const ORG = "bd100000-0000-4000-8000-000000000001";
const CAMPAIGN = "bd400000-0000-4000-8000-000000000001";
const ATTEMPT = "bd900000-0000-4000-8000-000000000001";
const SVIX_ID = "msg_2synthetic0000000000001";

/**
 * The canonical webhook tag shape. Resend types `WebhookEvent.data.tags` as
 * `Record<string, string>` -- an object, not the array the SEND api accepts.
 */
function csfTags(extra: Record<string, string> = {}) {
  return {
    csf_plugin: "dvhs_csf",
    csf_organization_id: ORG,
    ...extra,
  };
}

function makeRequest(body: string, headers: Record<string, string> = {}) {
  return new Request(
    "https://example.test/api/resend/webhook?organization=attacker",
    {
      method: "POST",
      body,
      headers: {
        "svix-id": SVIX_ID,
        "svix-timestamp": "1700000000",
        "svix-signature": "v1,synthetic-signature",
        ...headers,
      },
    },
  ) as unknown as Parameters<typeof route.POST>[0];
}

type LoggedLine = { message: string; fields: Record<string, unknown> };
const logged: LoggedLine[] = [];
let restoreInfo: typeof console.info;
let restoreError: typeof console.error;

beforeEach(() => {
  verifyCalls.length = 0;
  constructedApiKeys.length = 0;
  rpcCalls.length = 0;
  logged.length = 0;
  verifyImpl = () => ({ type: "email.sent", data: {} });
  rpcResult = {
    data: {
      duplicate: false,
      processingState: "reduced",
      reductionApplied: true,
    },
    error: null,
  };
  quarantineResult = {
    data: { quarantineId: "q-default", occurrenceCount: 1, firstCapture: true },
    error: null,
  };
  process.env.RESEND_WEBHOOK_SECRET = "whsec_synthetic";
  process.env.RESEND_API_KEY = "re_synthetic";

  restoreInfo = console.info;
  restoreError = console.error;
  console.info = ((message: string, fields: Record<string, unknown>) => {
    logged.push({ message, fields });
  }) as typeof console.info;
  console.error = ((message: string, fields: Record<string, unknown>) => {
    logged.push({ message, fields });
  }) as typeof console.error;
});

afterEach(() => {
  console.info = restoreInfo;
  console.error = restoreError;
});

describe("signed CSF poison is quarantined rather than discarded", () => {
  test("a CSF-tagged event with a malformed tenant tag is quarantined, not dropped", async () => {
    // The plugin tag says this came from us. Discarding it as "non-CSF" would delete
    // the only evidence that our own send produced an unroutable event -- and the
    // tenant tag is exactly the field a bug or tampered integration would corrupt.
    const poison =
      '{"type":"email.delivered","created_at":"2032-04-01T10:00:00.000Z","data":{"email_id":"synthetic-message-a","tags":{"csf_plugin":"dvhs_csf","csf_organization_id":"not-a-uuid"}}}';
    verifyImpl = () => JSON.parse(poison);
    quarantineResult = {
      data: { quarantineId: "q-2", occurrenceCount: 1, firstCapture: true },
      error: null,
    };

    const response = await route.POST(makeRequest(poison));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      quarantined: true,
      reasonCode: "unroutable_tenant",
    });

    const call = rpcCalls.find(
      (c) => c.fn === "csf_quarantine_communication_webhook",
    );
    expect(call!.args.p_claimed_organization_id).toBeNull();
    // Never the ledger: there is no tenant to record it under.
    expect(
      rpcCalls.some((c) => c.fn === "csf_record_communication_provider_event"),
    ).toBe(false);
  });

  // WHAT AN UNROUTABLE QUARANTINE ROW IS WORTH DEPENDS ENTIRELY ON WHAT IS ON IT.
  //
  // The tenant tag is one of five signed coordinates. `extractCsfRouting` used to
  // read the other four only after the organization tag parsed, so the single tag
  // most likely to be corrupt was the one whose corruption discarded the rest: the
  // row said "some CSF send, somewhere, produced an unroutable event" and an
  // officer had nothing to look up. The campaign and attempt tags are what turn it
  // into a specific send.
  //
  // Their names are still only claims -- the column is `p_claimed_*`, nothing has
  // been resolved against the tenant -- but a claim that parses as a uuid is
  // evidence, and it is exactly the evidence a triage needs.
  test("an unroutable tenant keeps the campaign and attempt the body did carry", async () => {
    const poison = JSON.stringify({
      type: "email.delivered",
      created_at: "2032-04-01T10:00:00.000Z",
      data: {
        email_id: "synthetic-message-a",
        tags: {
          csf_plugin: "dvhs_csf",
          csf_organization_id: "not-a-uuid",
          csf_campaign_id: CAMPAIGN,
          csf_attempt_id: ATTEMPT,
        },
      },
    });
    verifyImpl = () => JSON.parse(poison);

    const response = await route.POST(makeRequest(poison));

    expect(response.status).toBe(200);
    const call = rpcCalls.find(
      (c) => c.fn === "csf_quarantine_communication_webhook",
    );
    expect(call!.args.p_reason_code).toBe("unroutable_tenant");
    // Null, because no evidence proves a tenant. That part was always right.
    expect(call!.args.p_claimed_organization_id).toBeNull();
    // These are the ones that used to be thrown away with it.
    expect(call!.args.p_claimed_campaign_id).toBe(CAMPAIGN);
    expect(call!.args.p_claimed_attempt_id).toBe(ATTEMPT);
  });

  test("a malformed coordinate is still dropped rather than passed through", async () => {
    // The reverse guard. Reading the coordinates unconditionally must not mean
    // reading them uncritically: a non-uuid campaign tag is not a campaign, and
    // forwarding the raw string would put attacker-influenced text on an audit row
    // whose contract is bounded identifiers.
    const poison = JSON.stringify({
      type: "email.delivered",
      created_at: "2032-04-01T10:00:00.000Z",
      data: {
        email_id: "synthetic-message-a",
        tags: {
          csf_plugin: "dvhs_csf",
          csf_organization_id: "not-a-uuid",
          csf_campaign_id: "'; DROP TABLE --",
          csf_attempt_id: ATTEMPT,
        },
      },
    });
    verifyImpl = () => JSON.parse(poison);

    await route.POST(makeRequest(poison));

    const call = rpcCalls.find(
      (c) => c.fn === "csf_quarantine_communication_webhook",
    );
    expect(call!.args.p_claimed_campaign_id).toBeNull();
    expect(call!.args.p_claimed_attempt_id).toBe(ATTEMPT);
  });

  test("a CSF-tagged event with no usable type is quarantined", async () => {
    const shapeless =
      '{"data":{"email_id":"synthetic-message-a","tags":' +
      JSON.stringify(csfTags()) +
      "}}";
    verifyImpl = () => JSON.parse(shapeless);
    quarantineResult = {
      data: { quarantineId: "q-3", occurrenceCount: 1, firstCapture: true },
      error: null,
    };

    const response = await route.POST(makeRequest(shapeless));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      reasonCode: "malformed_event_shape",
    });
  });

  test("a signed CSF event of an unmodelled type is quarantined for triage", async () => {
    const unsupported =
      '{"type":"email.clicked","created_at":"2032-04-01T10:00:00.000Z","data":{"email_id":"synthetic-message-a","tags":' +
      JSON.stringify(csfTags()) +
      "}}";
    verifyImpl = () => JSON.parse(unsupported);
    quarantineResult = {
      data: { quarantineId: "q-4", occurrenceCount: 1, firstCapture: true },
      error: null,
    };

    const response = await route.POST(makeRequest(unsupported));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      reasonCode: "unsupported_event_shape",
    });

    // Even this benign-looking real Resend type is not echoed back: it is not one
    // of ours, so it collapses to the closed token like any other.
    const call = rpcCalls.find(
      (c) => c.fn === "csf_quarantine_communication_webhook",
    );
    expect(call!.args.p_event_type).toBe("unsupported");
  });

  // A VERIFIED SIGNATURE PROVES ORIGIN, NOT SAFETY.
  //
  // `boundedEventType` is bounded in length and nothing else. It used to reach a
  // durable `reason_detail`, the quarantine row's `event_type` column, and a
  // structured log line verbatim -- so a type carrying control characters could
  // corrupt a log pipeline, and one shaped like an address could plant text that
  // reads as recipient data inside an audit record whose contract is that it
  // holds none. Bounded is not sanitized.
  //
  // The event must still be durably quarantined. Dropping it would be the other
  // failure: Resend would retry it forever with nothing written.
  const HOSTILE_EVENT_TYPES = [
    {
      label: "control characters",
      value: "email.\u0000\u001b[31mclicked\r\n\tINJECTED",
    },
    { label: "an address-looking value", value: "victim.student@school.test" },
    { label: "a long token", value: `email.${"z".repeat(80)}` },
    { label: "json-ish punctuation", value: '{"$ne":null}--; DROP' },
  ];

  for (const hostile of HOSTILE_EVENT_TYPES) {
    test(`an unmodelled type with ${hostile.label} is quarantined without echoing it`, async () => {
      const body = JSON.stringify({
        type: hostile.value,
        created_at: "2032-04-01T10:00:00.000Z",
        data: { email_id: "synthetic-message-a", tags: csfTags() },
      });
      verifyImpl = () => JSON.parse(body);
      quarantineResult = {
        data: {
          quarantineId: "q-hostile",
          occurrenceCount: 1,
          firstCapture: true,
        },
        error: null,
      };

      const response = await route.POST(makeRequest(body));
      const payload = await response.text();

      // STILL DURABLE. The whole point of quarantine is that this is recorded.
      expect(response.status).toBe(200);
      expect(JSON.parse(payload)).toMatchObject({
        quarantined: true,
        reasonCode: "unsupported_event_shape",
      });

      const call = rpcCalls.find(
        (c) => c.fn === "csf_quarantine_communication_webhook",
      );
      expect(call).toBeDefined();

      // The closed token, and an authored sentence with no interpolation.
      expect(call!.args.p_event_type).toBe("unsupported");
      expect(call!.args.p_reason_detail).toBe(
        "signed CSF event type is not modelled by this ledger",
      );

      // NOWHERE. Every RPC argument, every log field, and the response body are
      // searched for the supplied string and for any distinctive fragment of it.
      const fragments = [
        hostile.value,
        hostile.value.slice(0, 24),
        ...hostile.value
          .split(/[^A-Za-z0-9.@]+/)
          .filter((part) => part.length >= 6),
      ];

      const rpcText = JSON.stringify(rpcCalls);
      const logText = JSON.stringify(logged);

      for (const fragment of fragments) {
        // "email." alone is a substring of the supported vocabulary, so only
        // fragments that are not themselves ordinary tokens are meaningful.
        if (fragment.length < 6 || fragment === "email.") continue;

        expect(
          rpcText,
          `RPC args leaked ${JSON.stringify(fragment)}`,
        ).not.toContain(fragment);
        expect(
          logText,
          `logs leaked ${JSON.stringify(fragment)}`,
        ).not.toContain(fragment);
        expect(
          payload,
          `response leaked ${JSON.stringify(fragment)}`,
        ).not.toContain(fragment);
      }

      // And the log field carries the closed token rather than being omitted, so
      // an operator still sees that something unmodelled arrived.
      const quarantineLog = logged.find((line) =>
        line.message.includes("Quarantined signed CSF webhook"),
      );
      expect(quarantineLog!.fields.eventType).toBe("unsupported");
    });
  }

  test("a non-CSF event's arbitrary type is not logged either", async () => {
    // Another product's type is no more trustworthy than ours and is modelled
    // even less. It takes the same closed treatment on the acknowledge path.
    const foreign = JSON.stringify({
      type: "vendor.\u001b[31mexploit\u0000ATTACKER",
      created_at: "2032-04-01T10:00:00.000Z",
      data: {
        email_id: "synthetic-message-z",
        tags: { other_plugin: "not_csf" },
      },
    });
    verifyImpl = () => JSON.parse(foreign);

    const response = await route.POST(makeRequest(foreign));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ received: true, csf: false });

    const logText = JSON.stringify(logged);
    expect(logText).not.toContain("ATTACKER");
    expect(logText).not.toContain("exploit");
    expect(logText).toContain("unsupported");
  });

  test("a quarantine outage on poison returns 5xx and stores nothing", async () => {
    const poison =
      '{"type":"email.delivered","data":{"email_id":"synthetic-message-a","tags":{"csf_plugin":"dvhs_csf","csf_organization_id":"bad"}}}';
    verifyImpl = () => JSON.parse(poison);
    quarantineResult = {
      data: null,
      error: { code: "08006", message: "connection reset" },
    };

    const response = await route.POST(makeRequest(poison));

    expect(response.status).toBeGreaterThanOrEqual(500);
  });

  test("a genuinely non-CSF signed event is acknowledged without quarantine", async () => {
    const other = '{"type":"email.sent","data":{"email_id":"other-product"}}';
    verifyImpl = () => JSON.parse(other);

    const response = await route.POST(makeRequest(other));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ csf: false });
    expect(rpcCalls).toHaveLength(0);
  });

  test("quarantine records only bounded operational evidence, never the body", async () => {
    const poison =
      '{"type":"email.delivered","data":{"email_id":"synthetic-message-a","from":"DVHS CSF <csf@notifications.lets-assist.com>","to":["student@example.test"],"subject":"Private subject","html":"<p>secret</p>","tags":{"csf_plugin":"dvhs_csf","csf_organization_id":"bad"}}}';
    verifyImpl = () => JSON.parse(poison);
    quarantineResult = {
      data: { quarantineId: "q-5", occurrenceCount: 1, firstCapture: true },
      error: null,
    };

    await route.POST(makeRequest(poison));

    const call = rpcCalls.find(
      (c) => c.fn === "csf_quarantine_communication_webhook",
    );
    const serialized = JSON.stringify(call!.args);
    for (const forbidden of [
      "student@example.test",
      "Private subject",
      "secret",
      poison,
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    // The digest stands in for the body.
    expect(call!.args.p_raw_body_hash).toBe(
      createHash("sha256").update(poison, "utf8").digest("hex"),
    );
  });

  test("signed overlong provider coordinates are digested, durably quarantined, and acknowledged", async () => {
    const rawEnvelopeId = `msg_${"e".repeat(400)}`;
    const rawMessageId = `email_${"m".repeat(400)}`;
    const poison = JSON.stringify({
      type: "email.delivered",
      data: {
        email_id: rawMessageId,
        tags: {
          csf_plugin: "dvhs_csf",
          csf_organization_id: "not-a-uuid",
        },
      },
    });
    verifyImpl = () => JSON.parse(poison);

    const first = await route.POST(
      makeRequest(poison, { "svix-id": rawEnvelopeId }),
    );
    const second = await route.POST(
      makeRequest(poison, { "svix-id": rawEnvelopeId }),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await first.json()).toMatchObject({
      quarantined: true,
      reasonCode: "unroutable_tenant",
    });

    const calls = rpcCalls.filter(
      (call) => call.fn === "csf_quarantine_communication_webhook",
    );
    expect(calls).toHaveLength(2);

    const firstArgs = calls[0].args;
    expect(firstArgs.p_provider_event_id).toMatch(/^qevt_sha256_[0-9a-f]{64}$/);
    expect(firstArgs.p_provider_message_id).toMatch(
      /^qmsg_sha256_[0-9a-f]{64}$/,
    );
    expect(String(firstArgs.p_provider_event_id).length).toBeLessThanOrEqual(
      255,
    );
    expect(String(firstArgs.p_provider_message_id).length).toBeLessThanOrEqual(
      255,
    );
    expect(firstArgs.p_provider_event_id).not.toContain(rawEnvelopeId);
    expect(firstArgs.p_provider_message_id).not.toContain(rawMessageId);

    // The same signed event reaches the same quarantine key on a provider retry.
    expect(calls[1].args.p_provider_event_id).toBe(
      firstArgs.p_provider_event_id,
    );
    expect(calls[1].args.p_provider_message_id).toBe(
      firstArgs.p_provider_message_id,
    );
    expect(JSON.stringify(logged)).not.toContain(rawEnvelopeId);
    expect(JSON.stringify(logged)).not.toContain(rawMessageId);
  });
});

describe("metadata is allowlisted, never content", () => {
  test("only named operational scalars are forwarded", () => {
    const metadata = route.buildProviderEventMetadata(
      {
        // Bounce detail only arrives on a bounce event, and the resolvers are
        // scoped to that envelope type for the same reason suppressionType is
        // scoped to email.suppressed: a bounce block must not be derivable from
        // a `bounce` object attached to some other event.
        type: "email.bounced",
        data: {
          email_id: "synthetic-message-a",
          broadcast_id: "synthetic-broadcast",
          from: "DVHS CSF <csf@notifications.lets-assist.com>",
          to: ["student@example.test"],
          subject: "Spring 2032 partner club audit",
          html: "<p>body</p>",
          text: "body",
          headers: { "x-secret": "value" },
          bounce: {
            type: "Permanent",
            subType: "General",
            message: "mailbox does not exist",
          },
        },
      },
      {
        isCsf: true,
        claimsCsf: true,
        organizationId: ORG,
        campaignId: CAMPAIGN,
        attemptId: ATTEMPT,
        environment: null,
        topicKey: "partner_clubs",
      },
    );

    expect(metadata).toEqual({
      emailId: "synthetic-message-a",
      broadcastId: "synthetic-broadcast",
      bounceType: "Permanent",
      bounceSubtype: "General",
      topicKey: "partner_clubs",
    });

    const serialized = JSON.stringify(metadata);
    for (const forbidden of [
      "student@example.test",
      "csf@notifications.lets-assist.com",
      "Spring 2032 partner club audit",
      "<p>body</p>",
      "x-secret",
      "mailbox does not exist",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  test("string metadata is length-bounded before it reaches the ledger", () => {
    const metadata = route.buildProviderEventMetadata(
      { data: { email_id: "e".repeat(500) } },
      {
        isCsf: true,
        claimsCsf: true,
        organizationId: ORG,
        campaignId: null,
        attemptId: null,
        environment: null,
        topicKey: null,
      },
    );

    expect((metadata.emailId as string).length).toBe(200);
  });
});

describe("logs never carry recipient or message content", () => {
  test("a successful CSF event logs only opaque identifiers and outcomes", async () => {
    const raw =
      '{"type":"email.delivered","created_at":"2032-04-01T10:05:00.000Z","data":{"email_id":"synthetic-message-a","from":"DVHS CSF <csf@notifications.lets-assist.com>","to":["student@example.test"],"subject":"Spring 2032 partner club audit","html":"<p>secret body</p>","tags":' +
      JSON.stringify(csfTags()) +
      "}}";
    verifyImpl = () => JSON.parse(raw);

    await route.POST(makeRequest(raw));

    const serialized = JSON.stringify(logged);
    for (const forbidden of [
      "student@example.test",
      "csf@notifications.lets-assist.com",
      "Spring 2032 partner club audit",
      "secret body",
      raw,
    ]) {
      expect(serialized).not.toContain(forbidden);
    }

    expect(
      logged.some((line) =>
        line.message.includes("Recorded CSF provider event"),
      ),
    ).toBe(true);
  });

  test("the inbound-email event type no longer logs sender or subject", async () => {
    // This is the exact shape the previous implementation logged from/subject
    // for. It is untagged, so it is acknowledged and nothing is recorded.
    const raw =
      '{"type":"email.received","data":{"email_id":"inbound-1","from":"parent@example.test","subject":"Question about points"}}';
    verifyImpl = () => JSON.parse(raw);

    await route.POST(makeRequest(raw));

    const serialized = JSON.stringify(logged);
    expect(serialized).not.toContain("parent@example.test");
    expect(serialized).not.toContain("Question about points");
  });
});

describe("a ledger failure is logged as a bounded code, never as raw database text", () => {
  const raw =
    '{"type":"email.bounced","created_at":"2032-04-01T11:00:00.000Z","data":{"email_id":"synthetic-message-a","tags":' +
    JSON.stringify(csfTags()) +
    "}}";

  /**
   * The shape a real PostgREST failure has when a constraint fires on these
   * tables: an authored sentence, plus a `details` blob carrying the offending
   * ROW -- which for a delivery or a snapshot means a recipient address.
   */
  const PII_ADDRESS = "late.optout@local.test";
  const LONG_DB_DETAIL =
    "Failing row contains (" +
    PII_ADDRESS +
    ", " +
    "Spring 2032 partner club audit, " +
    "x".repeat(4000) +
    ")";

  test("a refused ledger write logs a closed reason code and a validated SQLSTATE only", async () => {
    rpcResult = {
      data: null,
      error: {
        code: "23505",
        message:
          'CSF provider webhook envelope was already recorded with different immutable evidence for "' +
          PII_ADDRESS +
          '". ' +
          LONG_DB_DETAIL,
      },
    };
    verifyImpl = () => JSON.parse(raw);

    const response = await route.POST(makeRequest(raw));
    const body = JSON.stringify(await response.json());
    const serialized = JSON.stringify(logged);

    for (const forbidden of [
      PII_ADDRESS,
      LONG_DB_DETAIL,
      "Failing row contains",
    ]) {
      expect(serialized).not.toContain(forbidden);
      expect(body).not.toContain(forbidden);
    }
    expect(serialized).not.toContain("x".repeat(50));

    const refusal = logged.find((line) =>
      line.message.includes("refused by the ledger"),
    );
    expect(refusal).toBeDefined();
    expect(refusal!.fields.reasonCode).toBe("immutable_replay_conflict");
    expect(refusal!.fields.sqlstate).toBe("23505");
    // The old field is gone, not merely shortened.
    expect(refusal!.fields.reason).toBeUndefined();
  });

  test("an unrecognized ledger message becomes one slug, not a truncated sentence", async () => {
    rpcResult = {
      data: null,
      error: {
        code: "53300",
        message: "connection to server failed while writing for " + PII_ADDRESS,
      },
    };
    verifyImpl = () => JSON.parse(raw);

    const response = await route.POST(makeRequest(raw));

    expect(response.status).toBeGreaterThanOrEqual(500);
    const refusal = logged.find((line) =>
      line.message.includes("refused by the ledger"),
    );
    expect(refusal!.fields.reasonCode).toBe("unclassified_ledger_failure");
    expect(JSON.stringify(logged)).not.toContain(PII_ADDRESS);
  });

  test("a malformed SQLSTATE is dropped rather than logged as free text", () => {
    expect(route.boundedSqlState("23505")).toBe("23505");
    expect(route.boundedSqlState("P0001")).toBe("P0001");
    // Anything that is not five uppercase alphanumerics is not a SQLSTATE, and a
    // loosely typed client field is one more place unbounded text can arrive.
    expect(route.boundedSqlState("PGRST116 " + PII_ADDRESS)).toBeNull();
    expect(route.boundedSqlState("23505;DROP")).toBeNull();
    expect(route.boundedSqlState(null)).toBeNull();
    expect(route.boundedSqlState(undefined)).toBeNull();
  });

  test("a quarantine outage logs a bounded code instead of the storage message", async () => {
    rpcResult = {
      data: null,
      error: {
        code: "23505",
        message: "was already recorded with different immutable evidence",
      },
    };
    quarantineResult = {
      data: null,
      error: {
        code: "53300",
        message: "no slots left while storing " + PII_ADDRESS,
      },
    };
    verifyImpl = () => JSON.parse(raw);

    const response = await route.POST(makeRequest(raw));

    expect(response.status).toBe(503);
    expect(JSON.stringify(logged)).not.toContain(PII_ADDRESS);
    const failure = logged.find((line) =>
      line.message.includes("quarantine failed"),
    );
    expect(failure!.fields.quarantineFailureCode).toBe(
      "unclassified_ledger_failure",
    );
    expect(failure!.fields.sqlstate).toBe("53300");
  });

  test("a thrown ledger fault carrying PII reaches neither the log nor the response", async () => {
    verifyImpl = () => JSON.parse(raw);
    const thrown = new Error(
      "SASL auth failed for " + PII_ADDRESS + " -- " + LONG_DB_DETAIL,
    );
    // A throw site controls `name` as freely as `message`, so neither may be
    // logged. The kind is derived from constructor identity instead.
    thrown.name = "PostgresError[" + PII_ADDRESS + "]";
    rpcResult = {
      get data(): never {
        throw thrown;
      },
      error: null,
    } as unknown as typeof rpcResult;

    const response = await route.POST(makeRequest(raw));
    const body = JSON.stringify(await response.json());
    const serialized = JSON.stringify(logged);

    expect(response.status).toBe(503);
    for (const forbidden of [PII_ADDRESS, LONG_DB_DETAIL, "SASL auth failed"]) {
      expect(serialized).not.toContain(forbidden);
      expect(body).not.toContain(forbidden);
    }

    const failure = logged.find((line) =>
      line.message.includes("Failed to record CSF provider event"),
    );
    expect(failure).toBeDefined();
    expect(failure!.fields.faultKind).toBe("error");
    expect(failure!.fields.reason).toBeUndefined();
  });

  test("the fault kind is derived from constructor identity, not from a name string", () => {
    const spoofed = new Error("boom");
    spoofed.name = "TypeError";
    expect(route.thrownFaultKind(spoofed)).toBe("error");
    expect(route.thrownFaultKind(new TypeError("boom"))).toBe("type_error");
    expect(route.thrownFaultKind(new SyntaxError("boom"))).toBe("syntax_error");
    expect(route.thrownFaultKind("student@example.test")).toBe("non_error");
    expect(route.thrownFaultKind({ message: "student@example.test" })).toBe(
      "non_error",
    );
  });
});

/**
 * email.suppressed subtype handling.
 *
 * https://resend.com/docs/webhooks/emails/suppressed documents the payload as
 * `data.suppressed = { message, type }` with exactly one literal for `type`: the
 * case-sensitive "OnAccountSuppressionList". Installed resend 6.18.1 types
 * `EmailSuppressed.type` as a bare `string`, not an enum, so the provider can add
 * subtypes at any time with no signal to us.
 *
 * Two separate properties are under test:
 *
 *   1. `message` -- provider free text that can carry the recipient's address,
 *      the documented token itself, SQL-shaped text, and log-injection controls
 *      -- is never read, stored, logged, or used to classify.
 *   2. `type` is persisted only as a bounded ASCII token. Anything else becomes
 *      the fixed literal "Unknown", so SQL sees "the provider said something we
 *      do not model" rather than an absence it might guess about.
 */
/**
 * email.bounced type and subtype handling.
 *
 * https://resend.com/docs/webhooks/emails/bounced documents three bounce types --
 * Permanent, Transient, Undetermined -- and the installed SDK types the field as
 * a bare `string`, so the provider can extend it. Subtype values are
 * provider-evolving strings with no documented closed set.
 *
 * `bounceType` decides how long a real address stays blocked, so it is pinned to
 * the reviewed literals and nothing else. `bounceSubtype` is bounded diagnostic
 * evidence that nothing classifies on. Previously both went through a generic
 * `slice(0, 200)`, so any 200-character prefix of anything -- an address, prose,
 * SQL, control bytes -- was persisted and then interpolated into a durable
 * operator-facing safety reason.
 */
