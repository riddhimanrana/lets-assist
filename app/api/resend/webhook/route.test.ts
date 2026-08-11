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
      return fn === "csf_quarantine_communication_webhook"
        ? quarantineResult
        : rpcResult;
    },
  }),
}));

const route = await import("./implementation");
/**
 * Imported after the module mocks above, for the same reason `route` is: a static
 * import would be hoisted ahead of them. Used only by the body-consumption probe,
 * which needs a REAL request object rather than the plain `Request` the other
 * helpers cast.
 */
const { NextRequest } = await import("next/server");

const ORG = "bd100000-0000-4000-8000-000000000001";
const CAMPAIGN = "bd400000-0000-4000-8000-000000000001";
const ATTEMPT = "bd900000-0000-4000-8000-000000000001";
const SVIX_ID = "msg_2synthetic0000000000001";
const CURRENT_ENVIRONMENT = "abcdefghijklmnopqrst";
const FOREIGN_ENVIRONMENT = "zyxwvutsrqponmlkjihg";

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

/** The legacy array projection, kept only as a defensive compatibility path. */
function csfLegacyTags(extra: Array<{ name: string; value: string }> = []) {
  return [
    { name: "csf_plugin", value: "dvhs_csf" },
    { name: "csf_organization_id", value: ORG },
    ...extra,
  ];
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
  process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${CURRENT_ENVIRONMENT}.supabase.co`;

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

describe("signature verification happens before the body is interpreted", () => {
  test("verify receives the byte-exact raw body, not a re-serialized object", async () => {
    // Deliberately odd formatting: whitespace and key order survive only if the
    // route hands the original string to verify().
    const raw =
      '{  "type":"email.sent",\n  "created_at":"2032-04-01T10:00:00.000Z",\n  "data":{"email_id":"synthetic-message-a","tags":{"csf_plugin":"dvhs_csf","csf_organization_id":"' +
      ORG +
      '"}}}';
    verifyImpl = () => JSON.parse(raw);

    await route.POST(makeRequest(raw));

    expect(verifyCalls).toHaveLength(1);
    expect(verifyCalls[0].payload).toBe(raw);
  });

  test("an unverifiable body is rejected and never reaches the ledger", async () => {
    verifyImpl = () => {
      throw new Error("bad signature");
    };

    const response = await route.POST(makeRequest('{"type":"email.sent"}'));

    expect(response.status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
  });

  test("a failed verification logs no payload fragment", async () => {
    verifyImpl = () => {
      throw new Error("bad signature: secret-looking-content");
    };

    await route.POST(makeRequest('{"data":{"subject":"Board decision"}}'));

    const serialized = JSON.stringify(logged);
    expect(serialized).not.toContain("Board decision");
    expect(serialized).not.toContain("secret-looking-content");
  });

  test("the attacker-controlled svix-id is never logged before verification", async () => {
    verifyImpl = () => {
      throw new Error("bad signature");
    };

    await route.POST(makeRequest('{"type":"email.sent"}'));

    const serialized = JSON.stringify(logged);
    // Only a one-way digest of the envelope id may appear pre-verification.
    expect(serialized).not.toContain(SVIX_ID);
    expect(serialized).toContain(
      createHash("sha256").update(SVIX_ID, "utf8").digest("hex").slice(0, 16),
    );
  });

  test("verification needs only the webhook secret, not a send API key", async () => {
    delete process.env.RESEND_API_KEY;
    const raw =
      '{"type":"email.delivered","created_at":"2032-04-01T10:05:00.000Z","data":{"email_id":"synthetic-message-a","tags":' +
      JSON.stringify(csfTags()) +
      "}}";
    verifyImpl = () => JSON.parse(raw);

    const response = await route.POST(makeRequest(raw));

    // A receive-only deployment must still record evidence: verification is a
    // local HMAC over the raw body and never touches the send credential.
    //
    // Rejecting here would not lose the event -- Resend delivers at least once
    // and retries anything that is not a 200 -- it would do something worse. The
    // same event would be redelivered on every retry, each attempt refused over a
    // credential that plays no part in verifying or storing it, so a missing SEND
    // key would convert into an accumulating redelivery backlog while the
    // evidence it was retrying to deliver was still never recorded.
    expect(response.status).toBe(200);
    expect(verifyCalls).toHaveLength(1);
    expect(rpcCalls).toHaveLength(1);
  });

  /**
   * A request that cannot possibly verify must not have its body buffered.
   *
   * Anyone can POST here. If the handler reads the body before checking that the
   * three Svix headers are even present, then an unauthenticated caller decides
   * how many bytes this endpoint buffers, for a request it was always going to
   * refuse. Checking the headers first makes that cost a few header lookups.
   *
   * THE OBSERVABLE IS `bodyUsed`, NOT STREAM PULLS.
   *
   * A `ReadableStream` body whose `pull` is counted looks like the stronger
   * signal, and it is not: this runtime drains a request stream into an internal
   * buffer on a microtask after construction, for both `Request` and
   * `NextRequest`, whether or not the consumer ever reads it. A pull counter
   * therefore measures the transport, reaches 1 on a request the route refused
   * without touching, and would assert something false.
   *
   * `bodyUsed` is the per-spec consumer signal and behaves correctly here: it
   * stays `false` through construction and through that eager buffering, and
   * flips to `true` only when something calls a body-reading method. So it says
   * exactly what this test needs -- "the route did not call `req.text()`" -- with
   * no network and no timing dependence. The positive control below is what keeps
   * it honest.
   *
   * The stream body is retained so the request is a realistic streamed POST
   * rather than a pre-materialized string, and so the payload handed to the
   * verifier can be checked byte for byte in the positive control.
   */
  function streamBodyRequest(headers: Record<string, string>) {
    const body = new ReadableStream({
      pull(controller) {
        controller.enqueue(
          new TextEncoder().encode('{"type":"email.sent","data":{}}'),
        );
        controller.close();
      },
    });

    // `duplex: "half"` is required to construct a request from a stream and is
    // absent from the init type, hence the widening cast. It is taken from the
    // constructor's own parameter type rather than the DOM `RequestInit`, which
    // NextRequest does not accept.
    const request = new NextRequest("https://example.test/api/resend/webhook", {
      method: "POST",
      body,
      duplex: "half",
      headers,
    } as unknown as ConstructorParameters<typeof NextRequest>[1]);

    return {
      request: request as unknown as Parameters<typeof route.POST>[0],
      bodyUsed: () => request.bodyUsed,
    };
  }

  test("a request missing the Svix headers is refused without reading its body", async () => {
    const missingHeaderCases: Array<[string, Record<string, string>]> = [
      ["no svix headers at all", {}],
      [
        "no svix-id",
        { "svix-timestamp": "1700000000", "svix-signature": "v1,synthetic" },
      ],
      [
        "no svix-timestamp",
        { "svix-id": SVIX_ID, "svix-signature": "v1,synthetic" },
      ],
      [
        "no svix-signature",
        { "svix-id": SVIX_ID, "svix-timestamp": "1700000000" },
      ],
    ];

    for (const [label, headers] of missingHeaderCases) {
      verifyCalls.length = 0;
      rpcCalls.length = 0;

      const probe = streamBodyRequest(headers);
      const response = await route.POST(probe.request);

      expect(`${label}=${response.status}`).toBe(`${label}=400`);
      // THE ASSERTION THAT MATTERS: the route never consumed the body, i.e. it
      // never called req.text() on a request it was always going to refuse.
      expect(`${label} bodyUsed=${probe.bodyUsed()}`).toBe(
        `${label} bodyUsed=false`,
      );
      // And nothing downstream ran either.
      expect(`${label} verify=${verifyCalls.length}`).toBe(`${label} verify=0`);
      expect(`${label} rpc=${rpcCalls.length}`).toBe(`${label} rpc=0`);
    }
  });

  test("the same probe DOES observe consumption once the headers are present", async () => {
    // The positive control. Without it, the assertion above would still pass if
    // the probe simply never reported consumption -- proving nothing about the
    // ordering, only that the counter was broken.
    verifyImpl = () => ({ type: "email.sent", data: {} });

    const probe = streamBodyRequest({
      "svix-id": SVIX_ID,
      "svix-timestamp": "1700000000",
      "svix-signature": "v1,synthetic-signature",
    });
    const response = await route.POST(probe.request);

    expect(response.status).toBe(200);
    // bodyUsed does flip when the route reads, so `false` above is a real
    // observation about the route and not a probe that never reports anything.
    expect(probe.bodyUsed()).toBe(true);
    // And the verifier received the exact bytes the stream produced.
    expect(verifyCalls).toHaveLength(1);
    expect(verifyCalls[0].payload).toBe('{"type":"email.sent","data":{}}');
  });

  test("a missing webhook secret asks the provider to retry rather than giving up", async () => {
    delete process.env.RESEND_WEBHOOK_SECRET;

    const response = await route.POST(makeRequest('{"type":"email.sent"}'));

    expect(response.status).toBe(500);
    expect(verifyCalls).toHaveLength(0);
  });
});

describe("exact raw body hash", () => {
  test("persists the SHA-256 of the raw string the provider signed", async () => {
    const raw =
      '{"type":"email.delivered","created_at":"2032-04-01T10:05:00.000Z","data":{"email_id":"synthetic-message-a","tags":' +
      JSON.stringify(csfTags()) +
      "}}";
    verifyImpl = () => JSON.parse(raw);

    await route.POST(makeRequest(raw));

    const expected = createHash("sha256").update(raw, "utf8").digest("hex");
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].args.p_raw_body_hash).toBe(expected);
    // The same digest the helper exposes, so the ledger and any later re-check
    // agree on what "the raw body" meant.
    expect(route.sha256Hex(raw)).toBe(expected);
  });

  test("a re-serialized body would produce a different digest", () => {
    const raw = '{ "type":"email.sent",  "data":{} }';
    const reserialized = JSON.stringify(JSON.parse(raw));
    expect(route.sha256Hex(raw)).not.toBe(route.sha256Hex(reserialized));
  });
});

describe("CSF routing comes from signed object-shaped tags", () => {
  test("object-shaped signed tags route to the ledger with the tagged organization", async () => {
    const raw =
      '{"type":"email.bounced","created_at":"2032-04-01T11:00:00.000Z","data":{"email_id":"synthetic-message-a","bounce":{"type":"Permanent","subType":"General","message":"mailbox does not exist"},"tags":' +
      JSON.stringify(csfTags({ csf_topic_key: "partner_clubs" })) +
      "}}";
    verifyImpl = () => JSON.parse(raw);

    const response = await route.POST(makeRequest(raw));

    expect(response.status).toBe(200);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe("csf_record_communication_provider_event");
    expect(rpcCalls[0].args.p_organization_id).toBe(ORG);
    expect(rpcCalls[0].args.p_event_type).toBe("email.bounced");
    expect(rpcCalls[0].args.p_provider_message_id).toBe("synthetic-message-a");
    expect(rpcCalls[0].args.p_signature_verified).toBe(true);
  });

  test("the signed attempt and campaign coordinates reach the ledger", async () => {
    // This is what makes a webhook that beats local settlement recoverable
    // without reading message content or a recipient address.
    const raw =
      '{"type":"email.delivered","created_at":"2032-04-01T11:30:00.000Z","data":{"email_id":"synthetic-message-early","tags":' +
      JSON.stringify(
        csfTags({
          csf_campaign_id: CAMPAIGN,
          csf_attempt_id: ATTEMPT,
          csf_topic_key: "partner_clubs",
        }),
      ) +
      "}}";
    verifyImpl = () => JSON.parse(raw);

    await route.POST(makeRequest(raw));

    expect(rpcCalls[0].args.p_attempt_id).toBe(ATTEMPT);
    expect(rpcCalls[0].args.p_campaign_id).toBe(CAMPAIGN);
  });

  test("the signed environment coordinate is exposed by routing", () => {
    const routing = route.extractCsfRouting({
      data: {
        tags: csfTags({ csf_environment: CURRENT_ENVIRONMENT }),
      },
    });

    expect(routing.environment).toBe(CURRENT_ENVIRONMENT);
  });

  test("a foreign environment event is acknowledged without ledger or quarantine writes", async () => {
    const raw =
      '{"type":"email.delivered","created_at":"2032-04-01T11:30:00.000Z","data":{"email_id":"synthetic-foreign-message","tags":' +
      JSON.stringify(
        csfTags({
          csf_environment: FOREIGN_ENVIRONMENT,
          csf_campaign_id: CAMPAIGN,
          csf_attempt_id: ATTEMPT,
        }),
      ) +
      "}}";
    verifyImpl = () => JSON.parse(raw);

    const response = await route.POST(makeRequest(raw));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      received: true,
      csf: true,
      foreignEnvironment: true,
    });
    expect(rpcCalls).toHaveLength(0);
  });

  test("a matching environment event reaches the owning ledger", async () => {
    const raw =
      '{"type":"email.delivered","created_at":"2032-04-01T11:30:00.000Z","data":{"email_id":"synthetic-current-message","tags":' +
      JSON.stringify(
        csfTags({
          csf_environment: CURRENT_ENVIRONMENT,
          csf_campaign_id: CAMPAIGN,
          csf_attempt_id: ATTEMPT,
        }),
      ) +
      "}}";
    verifyImpl = () => JSON.parse(raw);

    const response = await route.POST(makeRequest(raw));

    expect(response.status).toBe(200);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe("csf_record_communication_provider_event");
  });

  test("a non-uuid attempt tag is forwarded as null rather than passed through", () => {
    const routing = route.extractCsfRouting({
      data: {
        tags: {
          csf_plugin: "dvhs_csf",
          csf_organization_id: ORG,
          csf_attempt_id: "'; DROP TABLE --",
        },
      },
    });

    expect(routing.isCsf).toBe(true);
    expect(routing.attemptId).toBeNull();
  });

  test("the legacy array tag shape still routes as a defensive fallback", async () => {
    const raw =
      '{"type":"email.sent","created_at":"2032-04-01T09:00:00.000Z","data":{"email_id":"synthetic-message-legacy","tags":' +
      JSON.stringify(
        csfLegacyTags([{ name: "csf_attempt_id", value: ATTEMPT }]),
      ) +
      "}}";
    verifyImpl = () => JSON.parse(raw);

    await route.POST(makeRequest(raw));

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].args.p_organization_id).toBe(ORG);
    expect(rpcCalls[0].args.p_attempt_id).toBe(ATTEMPT);
  });

  test("an untagged signed event is acknowledged without CSF persistence", async () => {
    const raw =
      '{"type":"email.sent","data":{"email_id":"other-product-message"}}';
    verifyImpl = () => JSON.parse(raw);

    const response = await route.POST(makeRequest(raw));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ received: true, csf: false });
    expect(rpcCalls).toHaveLength(0);
  });

  test("a query parameter cannot route an untagged event into a tenant", async () => {
    const raw =
      '{"type":"email.sent","data":{"email_id":"other-product-message"}}';
    verifyImpl = () => JSON.parse(raw);

    // The request URL carries ?organization=attacker; the route must ignore it.
    await route.POST(makeRequest(raw));

    expect(rpcCalls).toHaveLength(0);
  });

  test("a malformed organization tag does not route", () => {
    const routing = route.extractCsfRouting({
      data: {
        tags: { csf_plugin: "dvhs_csf", csf_organization_id: "not-a-uuid" },
      },
    });

    expect(routing.isCsf).toBe(false);
    expect(routing.organizationId).toBeNull();
  });

  test("email.suppressed is a modeled provider event type", () => {
    expect(route.isCsfSupportedEvent("email.suppressed")).toBe(true);
    expect(route.isCsfSupportedEvent("email.opened")).toBe(false);
  });
});

describe("provider occurrence time", () => {
  test("a missing provider time is forwarded as null rather than invented", async () => {
    const raw =
      '{"type":"email.delivered","data":{"email_id":"synthetic-message-a","tags":' +
      JSON.stringify(csfTags()) +
      "}}";
    verifyImpl = () => JSON.parse(raw);

    await route.POST(makeRequest(raw));

    expect(rpcCalls[0].args.p_occurred_at).toBeNull();
  });

  test("an unparseable provider time is treated as absent", () => {
    expect(route.resolveOccurredAt({ created_at: "not a date" })).toBeNull();
  });
});

describe("ledger failures are classified by structured error code", () => {
  const raw =
    '{"type":"email.bounced","created_at":"2032-04-01T11:00:00.000Z","data":{"email_id":"synthetic-message-a","tags":' +
    JSON.stringify(csfTags()) +
    "}}";

  test("a duplicate is reported by the ledger and acknowledged", async () => {
    rpcResult = {
      data: {
        duplicate: true,
        processingState: "reduced",
        reductionApplied: true,
      },
      error: null,
    };
    verifyImpl = () => JSON.parse(raw);

    const response = await route.POST(makeRequest(raw));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ duplicate: true });
  });

  test("an immutable replay conflict is quarantined and then acknowledged", async () => {
    // REPLACES A 409 EXPECTATION. Resend expects HTTP 200 and retries every other
    // response, so 409 never stopped anything -- it just meant the event came back
    // forever while nothing was ever written. The conflict itself becomes the
    // durable record, and only then is the event acknowledged.
    //
    // The assertion below is `200` exactly, not "any 2xx", because the contract is
    // exactly that: a 202 or 204 would be retried too.
    rpcResult = {
      data: null,
      error: {
        code: "23505",
        message:
          'CSF provider webhook envelope "msg_2synthetic0000000000001" was already recorded with different immutable evidence; refusing a conflicting replay.',
      },
    };
    quarantineResult = {
      data: { quarantineId: "q-1", occurrenceCount: 1, firstCapture: true },
      error: null,
    };
    verifyImpl = () => JSON.parse(raw);

    const response = await route.POST(makeRequest(raw));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      quarantined: true,
      reasonCode: "immutable_replay_conflict",
    });

    const quarantineCall = rpcCalls.find(
      (call) => call.fn === "csf_quarantine_communication_webhook",
    );
    expect(quarantineCall).toBeDefined();
    expect(quarantineCall!.args.p_reason_code).toBe(
      "immutable_replay_conflict",
    );
    expect(quarantineCall!.args.p_reason_detail).toBe(
      "envelope already recorded with different immutable evidence",
    );
    expect(quarantineCall!.args.p_raw_body_hash).toBe(
      createHash("sha256").update(raw, "utf8").digest("hex"),
    );
  });

  // QUARANTINING THE WRONG REASON IS QUARANTINING A LIE.
  //
  // The route derived a real reason code from the closed marker list and then filed
  // every permanent failure as `immutable_replay_conflict` with a replay sentence.
  // A cross-tenant routing tag and an unknown organization coordinate are security
  // evidence, not a duplicate webhook, and both reached the worklist wearing a
  // label an operator would reasonably close as a harmless retry.
  //
  // Each case below asserts the derived code AND that the detail is this module's
  // own sentence rather than the database's -- the ledger message deliberately
  // interpolates a coordinate here, and none of it may travel.
  test("cross-tenant evidence is quarantined under its own reason, not as a replay", async () => {
    rpcResult = {
      data: null,
      error: {
        code: "23503",
        message:
          'The CSF dispatch attempt "3f7c1e90-0000-4000-8000-00000000abcd" this webhook evidence names belongs to another organization.',
      },
    };
    quarantineResult = {
      data: { quarantineId: "q-2", occurrenceCount: 1, firstCapture: true },
      error: null,
    };
    verifyImpl = () => JSON.parse(raw);

    const response = await route.POST(makeRequest(raw));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      quarantined: true,
      reasonCode: "cross_tenant_evidence",
    });

    const quarantineCall = rpcCalls.find(
      (call) => call.fn === "csf_quarantine_communication_webhook",
    );
    expect(quarantineCall!.args.p_reason_code).toBe("cross_tenant_evidence");
    expect(quarantineCall!.args.p_reason_detail).toBe(
      "signed routing coordinate belongs to another organization",
    );
    // The interpolated attempt id from the ledger sentence never travels.
    expect(quarantineCall!.args.p_reason_detail).not.toContain("3f7c1e90");
  });

  test("an unknown tenant coordinate is quarantined under its own reason", async () => {
    rpcResult = {
      data: null,
      error: {
        code: "23503",
        message:
          'The CSF communication campaign "bd400000-0000-4000-8000-000000000099" this webhook evidence names does not exist in this organization.',
      },
    };
    quarantineResult = {
      data: { quarantineId: "q-3", occurrenceCount: 1, firstCapture: true },
      error: null,
    };
    verifyImpl = () => JSON.parse(raw);

    const response = await route.POST(makeRequest(raw));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      quarantined: true,
      reasonCode: "unknown_tenant_coordinate",
    });

    const quarantineCall = rpcCalls.find(
      (call) => call.fn === "csf_quarantine_communication_webhook",
    );
    expect(quarantineCall!.args.p_reason_code).toBe(
      "unknown_tenant_coordinate",
    );
    expect(quarantineCall!.args.p_reason_detail).toBe(
      "signed routing coordinate does not exist in this organization",
    );
    expect(quarantineCall!.args.p_reason_detail).not.toContain("bd400000");
  });

  test("contradictory routing evidence is quarantined under its own reason", async () => {
    rpcResult = {
      data: null,
      error: {
        code: "23514",
        message:
          "This CSF webhook names a dispatch attempt and a provider message that belong to different deliveries; refusing to bind contradictory evidence.",
      },
    };
    quarantineResult = {
      data: { quarantineId: "q-4", occurrenceCount: 1, firstCapture: true },
      error: null,
    };
    verifyImpl = () => JSON.parse(raw);

    const response = await route.POST(makeRequest(raw));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      quarantined: true,
      reasonCode: "contradictory_routing_evidence",
    });

    const quarantineCall = rpcCalls.find(
      (call) => call.fn === "csf_quarantine_communication_webhook",
    );
    expect(quarantineCall!.args.p_reason_code).toBe(
      "contradictory_routing_evidence",
    );
    expect(quarantineCall!.args.p_reason_detail).toBe(
      "signed routing tags name a dispatch attempt and a provider message belonging to different deliveries",
    );
  });

  // PERMANENCE REQUIRES AN AUTHORED SQLSTATE **AND** ITS MARKER.
  //
  // The earlier version of this test handed `23514` to every marker, which is
  // exactly the assumption that hid the defect: classification read the message
  // substring alone. `error.message` is whatever the client surfaces, and the
  // layers between this route and the ledger -- a PostgREST envelope, a pooler, a
  // proxy, a resource notice -- can each carry a sentence containing "belongs to
  // another organization" while being emphatically retryable. Such a failure was
  // acknowledged 200, filed as permanently quarantined, and never retried.
  //
  // The matrix below pairs each marker with its real code, and then withholds one
  // half at a time.
  const PERMANENT_MATRIX = [
    {
      sqlstate: "23505",
      message:
        'envelope "x" was already recorded with different immutable evidence; refusing a conflicting replay.',
      code: "immutable_replay_conflict",
    },
    {
      sqlstate: "23514",
      message:
        "This CSF webhook names a dispatch attempt and a provider message that belong to different deliveries; refusing to bind contradictory evidence.",
      code: "contradictory_routing_evidence",
    },
    {
      sqlstate: "23503",
      message: 'The CSF dispatch attempt "y" belongs to another organization.',
      code: "cross_tenant_evidence",
    },
    {
      sqlstate: "23503",
      message:
        'The CSF communication campaign "z" does not exist in this organization.',
      code: "unknown_tenant_coordinate",
    },
  ] as const;

  test("each marker paired with its authored SQLSTATE is permanent and quarantinable", () => {
    for (const row of PERMANENT_MATRIX) {
      const error = { message: row.message, code: row.sqlstate };

      expect(route.ledgerFailureClass(error)).toBe("permanent");
      expect(route.ledgerReasonCode(error)).toBe(row.code);
      // The two properties the quarantine path depends on, asserted together.
      expect(route.isQuarantineReasonCode(row.code)).toBe(true);
      expect(route.ledgerQuarantineDetail(row.code)).toBeTruthy();
    }
  });

  test("the right marker under the wrong SQLSTATE stays retryable", () => {
    // Every cross pairing that is not the authored one. `23503` legitimately
    // covers two markers, so a pairing is only wrong when no row authorises it.
    const authorised = new Set(
      PERMANENT_MATRIX.map((row) => `${row.sqlstate}|${row.code}`),
    );

    for (const row of PERMANENT_MATRIX) {
      for (const other of PERMANENT_MATRIX) {
        if (authorised.has(`${other.sqlstate}|${row.code}`)) continue;

        const error = { message: row.message, code: other.sqlstate };
        expect(
          route.ledgerFailureClass(error),
          `${row.code} must not be permanent under ${other.sqlstate}`,
        ).toBe("retryable");
        expect(route.ledgerReasonCode(error)).toBe(
          "unclassified_ledger_failure",
        );
      }
    }
  });

  test("a transport failure echoing a ledger sentence stays retryable", () => {
    // The live failure mode: an unrelated layer relaying our own text. None of
    // these may be acknowledged as durably quarantined.
    const impostors = [
      { code: "08006", label: "connection failure" },
      { code: "53300", label: "too many connections" },
      { code: "57014", label: "statement cancelled" },
      { code: "XX000", label: "internal error" },
      { code: "40001", label: "serialization failure" },
    ];

    for (const row of PERMANENT_MATRIX) {
      for (const impostor of impostors) {
        const error = { message: row.message, code: impostor.code };
        expect(
          route.ledgerFailureClass(error),
          `${impostor.label} carrying ${row.code}'s sentence must stay retryable`,
        ).toBe("retryable");
      }
    }
  });

  test("a missing or malformed SQLSTATE is never permanent", () => {
    // Routed through the same bounded helper the log field uses, so anything that
    // is not exactly five uppercase alphanumerics matches nothing at all.
    const malformed = [
      null,
      undefined,
      "",
      "2350",
      "235055",
      "23 05",
      "23505 ",
      "23505\n",
      "23505; DROP",
      "23505\u0000",
      "23e05".toLowerCase(),
      "abcde",
    ];

    for (const row of PERMANENT_MATRIX) {
      for (const code of malformed) {
        const error = {
          message: row.message,
          code: code as unknown as string | null,
        };
        expect(
          route.ledgerFailureClass(error),
          `code ${JSON.stringify(code)} must not classify ${row.code} as permanent`,
        ).toBe("retryable");
        expect(route.ledgerReasonCode(error)).toBe(
          "unclassified_ledger_failure",
        );
      }
    }

    // Lowercase is not a SQLSTATE, even when it spells a real class.
    expect(
      route.ledgerFailureClass({
        message: PERMANENT_MATRIX[0].message,
        code: "23505",
      }),
    ).toBe("permanent");
  });

  test("the authored SQLSTATE without its marker stays retryable", () => {
    // The generic class on its own proves nothing: 23505 is every unique
    // violation, 23503 every foreign-key violation in the schema.
    for (const sqlstate of ["23505", "23514", "23503"]) {
      const error = {
        message:
          'duplicate key value violates unique constraint "some_unrelated_index"',
        code: sqlstate,
      };
      expect(route.ledgerFailureClass(error)).toBe("retryable");
      expect(route.ledgerReasonCode(error)).toBe("unclassified_ledger_failure");
    }
  });

  test("a wrongly-classified failure never reaches the quarantine RPC", () => {
    // The consequence, asserted end to end rather than inferred: the route must
    // ask for a retry and write nothing.
    rpcResult = {
      data: null,
      error: {
        // Right sentence, transport code. Previously quarantined and 200'd.
        code: "08006",
        message:
          'The CSF dispatch attempt "y" belongs to another organization.',
      },
    };
    verifyImpl = () => JSON.parse(raw);

    return route.POST(makeRequest(raw)).then((response) => {
      expect(response.status).toBeGreaterThanOrEqual(500);
      expect(
        rpcCalls.some(
          (call) => call.fn === "csf_quarantine_communication_webhook",
        ),
      ).toBe(false);
    });
  });

  // `unclassified_ledger_failure` IS NOT A QUARANTINE REASON -- it is the log value
  // for a fault no marker matched. Such a fault is retryable, so it never reaches
  // the quarantine path at all. This pins that decision rather than the old
  // behaviour of inventing an authored sentence for it.
  test("an unclassified failure is retryable and has no quarantine vocabulary", () => {
    const error = {
      message: "remaining connection slots are reserved",
      code: "53300",
    };

    expect(route.ledgerFailureClass(error)).toBe("retryable");
    expect(route.ledgerReasonCode(error)).toBe("unclassified_ledger_failure");
    expect(route.isQuarantineReasonCode("unclassified_ledger_failure")).toBe(
      false,
    );
    expect(
      route.ledgerQuarantineDetail("unclassified_ledger_failure"),
    ).toBeNull();
  });

  // A Set lookup, so a reason code can never resolve to an inherited property.
  test("inherited object properties are not quarantine reason codes", () => {
    for (const key of [
      "constructor",
      "__proto__",
      "toString",
      "hasOwnProperty",
    ]) {
      expect(route.isQuarantineReasonCode(key)).toBe(false);
      expect(route.ledgerQuarantineDetail(key)).toBeNull();
    }
  });

  test("a quarantine storage outage returns 5xx so the provider retries", async () => {
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
        message: "remaining connection slots are reserved",
      },
    };
    verifyImpl = () => JSON.parse(raw);

    const response = await route.POST(makeRequest(raw));

    // Not durable, so not acknowledged.
    expect(response.status).toBeGreaterThanOrEqual(500);
  });

  test("a storage outage asks Resend to retry instead of discarding the event", async () => {
    // 53300 is too_many_connections: a retry genuinely can fix it, so it must not be
    // quarantined as though it were permanent.
    rpcResult = {
      data: null,
      error: {
        code: "53300",
        message: "remaining connection slots are reserved",
      },
    };
    verifyImpl = () => JSON.parse(raw);

    const response = await route.POST(makeRequest(raw));

    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(
      rpcCalls.some(
        (call) => call.fn === "csf_quarantine_communication_webhook",
      ),
    ).toBe(false);
  });

  test("a schema or runtime fault asks Resend to retry", async () => {
    rpcResult = {
      data: null,
      error: { code: "42883", message: "function does not exist" },
    };
    verifyImpl = () => JSON.parse(raw);

    const response = await route.POST(makeRequest(raw));

    expect(response.status).toBeGreaterThanOrEqual(500);
  });

  test("an unclassified ledger failure asks Resend to retry", async () => {
    rpcResult = {
      data: null,
      error: { message: "transport failed with no code" },
    };
    verifyImpl = () => JSON.parse(raw);

    const response = await route.POST(makeRequest(raw));

    expect(response.status).toBeGreaterThanOrEqual(500);
  });

  test("a generic unique violation is retryable, not a permanent conflict", () => {
    // 23505 is generic unique_violation. The ledger raises it for the immutable
    // replay conflict, but PostgreSQL also raises it for an ordinary concurrent
    // insert race that a retry WOULD resolve, so the class alone cannot decide.
    expect(
      route.ledgerFailureClass({
        message: "duplicate key value violates unique constraint",
        code: "23505",
      }),
    ).toBe("retryable");

    expect(
      route.ledgerFailureClass({
        message:
          'envelope "x" was already recorded with different immutable evidence; refusing a conflicting replay.',
        code: "23505",
      }),
    ).toBe("permanent");

    // Anything unrecognized is retryable: a retry is recoverable, a wrongly
    // quarantined event is not.
    expect(route.ledgerFailureClass({ message: "who knows", code: null })).toBe(
      "retryable",
    );
  });
});
