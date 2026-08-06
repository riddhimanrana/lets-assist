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
        organizationId: ORG,
        campaignId: CAMPAIGN,
        attemptId: ATTEMPT,
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
        organizationId: ORG,
        campaignId: null,
        attemptId: null,
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
describe("email.bounced carries only reviewed, bounded tokens", () => {
  function bouncedEvent(bounce: unknown) {
    return {
      type: "email.bounced",
      created_at: "2032-04-01T10:00:00.000Z",
      data: {
        email_id: "synthetic-message-bounced",
        tags: csfTags({ csf_attempt_id: ATTEMPT, csf_campaign_id: CAMPAIGN }),
        bounce,
      },
    };
  }

  function metadataFor(event: unknown) {
    return route.buildProviderEventMetadata(
      event,
      route.extractCsfRouting(event),
    );
  }

  test("each documented bounce type survives exactly", () => {
    for (const type of ["Permanent", "Transient", "Undetermined"]) {
      expect(`${type}=${route.resolveBounceType(bouncedEvent({ type }))}`).toBe(
        `${type}=${type}`,
      );
    }
    expect([...route.RESEND_BOUNCE_TYPES]).toEqual([
      "Permanent",
      "Transient",
      "Undetermined",
    ]);
  });

  test("no case, padding, or confusable mutation reproduces a reviewed type", () => {
    const mutations: Array<[string, string]> = [
      ["lowercase", "permanent"],
      ["uppercase", "PERMANENT"],
      ["legacy hard alias", "hard"],
      ["legacy soft alias", "soft"],
      ["legacy HardBounce", "HardBounce"],
      ["legacy delayed", "delayed"],
      ["leading space", " Permanent"],
      ["trailing space", "Permanent "],
      ["trailing newline", "Permanent\n"],
      ["embedded NUL", "Perma\u0000nent"],
      ["embedded escape", "Permanent\u001b[31m"],
      ["spaced out", "P e r m a n e n t"],
      ["punctuated", "Permanent!!!"],
      ["prefixed", "XPermanent"],
      ["suffixed", "PermanentX"],
      // Cyrillic small a (U+0430) inside an otherwise correct token.
      ["cyrillic confusable", "Permаnent"],
      // Fullwidth P (U+FF30).
      ["fullwidth confusable", "Ｐermanent"],
    ];

    for (const [label, type] of mutations) {
      const resolved = route.resolveBounceType(bouncedEvent({ type }));
      // The invariant: nothing here becomes a reviewed literal, so nothing here
      // can reach the permanent-block branch in SQL.
      expect(`${label}=${resolved}`).toBe(`${label}=Unknown`);
    }
  });

  test("a non-string or absent bounce type becomes Unknown", () => {
    const cases: Array<[string, unknown]> = [
      ["missing bounce", bouncedEvent(undefined)],
      ["null bounce", bouncedEvent(null)],
      ["bounce is array", bouncedEvent([{ type: "Permanent" }])],
      ["type null", bouncedEvent({ type: null })],
      ["type number", bouncedEvent({ type: 1 })],
      ["type object", bouncedEvent({ type: { value: "Permanent" } })],
      ["type empty", bouncedEvent({ type: "" })],
    ];
    for (const [label, event] of cases) {
      expect(`${label}=${route.resolveBounceType(event)}`).toBe(
        `${label}=Unknown`,
      );
    }
  });

  test("no hostile subtype value survives as anything but a bounded token", () => {
    const hostile: Array<[string, string]> = [
      ["address-shaped", "student@example.test"],
      ["SQL-shaped", "General'; DROP TABLE csf_communication_deliveries; --"],
      ["prose", "The mailbox you are trying to reach does not exist."],
      ["newline", "General\nInjected"],
      ["carriage return", "General\r\nInjected"],
      ["NUL", "General\u0000"],
      ["escape", "General\u001b[31m"],
      ["padded", " General "],
      ["overlong", `A${"b".repeat(64)}`],
      ["cyrillic confusable", "Generаl"],
      ["punctuated", "General/Suppressed"],
    ];

    for (const [label, subType] of hostile) {
      const resolved = route.resolveBounceSubtype(
        bouncedEvent({ type: "Permanent", subType }),
      );
      expect(`${label}=${resolved}`).toBe(`${label}=Unknown`);
    }
  });

  test("a well-formed subtype is kept verbatim as diagnostic evidence", () => {
    // Bounded, so it is safe to persist -- and nothing in the database reads it
    // to decide anything, so keeping the provider's exact word costs nothing.
    for (const subType of ["General", "NoEmail", "Suppressed", "MailboxFull"]) {
      expect(
        route.resolveBounceSubtype(
          bouncedEvent({ type: "Transient", subType }),
        ),
      ).toBe(subType);
    }
  });

  test("the free-text bounce message never reaches metadata", () => {
    const event = bouncedEvent({
      type: "Permanent",
      subType: "General",
      message:
        "550 5.1.1 student@example.test rejected; DROP TABLE csf_communication_deliveries; --",
    });
    const metadata = metadataFor(event);
    const serialized = JSON.stringify(metadata);

    expect(metadata.bounceType).toBe("Permanent");
    expect(metadata.bounceSubtype).toBe("General");
    for (const fragment of [
      "student@example.test",
      "DROP TABLE",
      "550 5.1.1",
      "csf_communication_deliveries",
    ]) {
      expect(serialized).not.toContain(fragment);
    }
    expect(Object.keys(metadata)).not.toContain("bounceMessage");
  });

  test("a hostile bounce reaches the RPC only as Unknown", async () => {
    const raw = JSON.stringify(
      bouncedEvent({
        type: "hard",
        subType: "student@example.test',(SELECT 1)",
        message: "prose the provider wrote",
      }),
    );
    verifyImpl = () => JSON.parse(raw);

    await route.POST(makeRequest(raw));

    const recorded = rpcCalls.find(
      (call) => call.fn === "csf_record_communication_provider_event",
    );
    const metadata = recorded!.args.p_metadata as Record<string, unknown>;

    // 'hard' is an alias the provider does not document. It must not become a
    // permanent block, and the only way to guarantee that end to end is for it
    // never to leave this route as anything but Unknown.
    expect(metadata.bounceType).toBe("Unknown");
    expect(metadata.bounceSubtype).toBe("Unknown");
    expect(JSON.stringify(recorded)).not.toContain("student@example.test");
    expect(JSON.stringify(recorded)).not.toContain("prose the provider wrote");
  });

  test("non-bounce events carry no bounce keys at all", () => {
    const delivered = {
      type: "email.delivered",
      created_at: "2032-04-01T10:00:00.000Z",
      data: {
        email_id: "synthetic-message-delivered",
        tags: csfTags(),
        // Attached to the wrong event on purpose: a block must not be derivable
        // from a bounce object riding on a delivery.
        bounce: { type: "Permanent", subType: "General" },
      },
    };

    const keys = Object.keys(metadataFor(delivered));
    expect(keys).not.toContain("bounceType");
    expect(keys).not.toContain("bounceSubtype");
  });
});

describe("email.suppressed carries only a bounded subtype token", () => {
  /** Free text engineered to be maximally hostile if it were ever retained. */
  const HOSTILE_MESSAGE =
    "OnAccountSuppressionList student@example.test'; DROP TABLE csf_communication_deliveries; --\n\r INFO fake log line";

  function suppressedEvent(
    suppressed: unknown,
    extraData: Record<string, unknown> = {},
  ) {
    return {
      type: "email.suppressed",
      created_at: "2032-04-01T10:00:00.000Z",
      data: {
        email_id: "synthetic-message-suppressed",
        tags: csfTags({ csf_attempt_id: ATTEMPT, csf_campaign_id: CAMPAIGN }),
        suppressed,
        ...extraData,
      },
    };
  }

  function metadataFor(event: unknown) {
    return route.buildProviderEventMetadata(
      event,
      route.extractCsfRouting(event),
    );
  }

  test("the official documented payload classifies exactly", () => {
    const event = suppressedEvent({
      message: "The recipient is on the account suppression list.",
      type: "OnAccountSuppressionList",
    });

    expect(route.resolveSuppressionType(event)).toBe(
      "OnAccountSuppressionList",
    );
    expect(metadataFor(event).suppressionType).toBe("OnAccountSuppressionList");
    // The exported constant and the behaviour agree, so a typo in either fails.
    expect(route.RESEND_ACCOUNT_SUPPRESSION_TYPE).toBe(
      "OnAccountSuppressionList",
    );
  });

  test("only data.suppressed.type is read; every other path is ignored", () => {
    const wrongPaths: Array<[string, unknown]> = [
      // The envelope type, not the subtype.
      [
        "data.type",
        suppressedEvent({ message: "m" }, { type: "OnAccountSuppressionList" }),
      ],
      // A sibling object with a plausible name.
      [
        "data.suppression.type",
        suppressedEvent(
          { message: "m" },
          { suppression: { type: "OnAccountSuppressionList" } },
        ),
      ],
      // The right object, the wrong field.
      [
        "data.suppressed.subType",
        suppressedEvent({ message: "m", subType: "OnAccountSuppressionList" }),
      ],
      [
        "data.suppressed.sub_type",
        suppressedEvent({ message: "m", sub_type: "OnAccountSuppressionList" }),
      ],
      // The free-text field, which is where the token most plausibly appears.
      [
        "data.suppressed.message",
        suppressedEvent({ message: "OnAccountSuppressionList" }),
      ],
    ];

    for (const [label, event] of wrongPaths) {
      expect(`${label}=${route.resolveSuppressionType(event)}`).toBe(
        `${label}=Unknown`,
      );
    }
  });

  test("every malformed shape becomes the fixed literal Unknown", () => {
    const cases: Array<[string, unknown]> = [
      ["missing", suppressedEvent(undefined)],
      ["null", suppressedEvent(null)],
      ["suppressed-is-number", suppressedEvent(42)],
      ["suppressed-is-string", suppressedEvent("OnAccountSuppressionList")],
      [
        "suppressed-is-array",
        suppressedEvent([{ type: "OnAccountSuppressionList" }]),
      ],
      ["type-null", suppressedEvent({ type: null })],
      ["type-number", suppressedEvent({ type: 1 })],
      ["type-boolean", suppressedEvent({ type: true })],
      [
        "type-object",
        suppressedEvent({ type: { value: "OnAccountSuppressionList" } }),
      ],
      ["type-array", suppressedEvent({ type: ["OnAccountSuppressionList"] })],
      ["type-empty", suppressedEvent({ type: "" })],
      // 65 characters: one past the bound.
      ["overlong", suppressedEvent({ type: `A${"b".repeat(64)}` })],
      ["leading-digit", suppressedEvent({ type: "1OnAccountSuppressionList" })],
      ["hyphenated", suppressedEvent({ type: "On-Account-Suppression-List" })],
      ["dotted", suppressedEvent({ type: "On.Account.Suppression.List" })],
    ];

    for (const [label, event] of cases) {
      expect(`${label}=${route.resolveSuppressionType(event)}`).toBe(
        `${label}=Unknown`,
      );
    }
  });

  test("no exactness mutation ever reproduces the documented literal", () => {
    const LITERAL = "OnAccountSuppressionList";
    const mutations: Array<[string, string]> = [
      ["lowercased", "onaccountsuppressionlist"],
      ["uppercased", "ONACCOUNTSUPPRESSIONLIST"],
      ["leading-space", " OnAccountSuppressionList"],
      ["trailing-space", "OnAccountSuppressionList "],
      ["trailing-newline", "OnAccountSuppressionList\n"],
      ["trailing-cr", "OnAccountSuppressionList\r"],
      ["tab-padded", "\tOnAccountSuppressionList"],
      ["embedded-nul", "OnAccount\u0000SuppressionList"],
      ["trailing-nul", "OnAccountSuppressionList\u0000"],
      ["embedded-control", "OnAccountSuppressionList\u0001"],
      ["prefixed", "XOnAccountSuppressionList"],
      ["suffixed", "OnAccountSuppressionListX"],
      ["underscore-suffixed", "OnAccountSuppressionList_v2"],
      // Cyrillic capital O (U+041E) standing in for ASCII 'O'.
      ["cyrillic-confusable", "\u041enAccountSuppressionList"],
      // Fullwidth Latin capital O (U+FF2F).
      ["fullwidth-confusable", "\uff2fnAccountSuppressionList"],
      // Zero-width space (U+200B) hidden mid-token.
      ["zero-width-split", "OnAccount\u200bSuppressionList"],
    ];

    for (const [label, type] of mutations) {
      const resolved = route.resolveSuppressionType(suppressedEvent({ type }));

      // THE INVARIANT: whatever is persisted, it is not the documented literal,
      // so the SQL exact comparison cannot grant an address-level block.
      expect(`${label}:${resolved === LITERAL ? "MATCHED" : "no-match"}`).toBe(
        `${label}:no-match`,
      );

      // Padded, control-bearing, and confusable values are not tokens at all, so
      // they flatten to Unknown rather than being stored verbatim.
      if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(type)) {
        expect(`${label}=${resolved}`).toBe(`${label}=Unknown`);
      }
    }
  });

  test("a case-mutated token is stored verbatim and is still not the literal", () => {
    // 'onaccountsuppressionlist' IS a well-formed token, so it is persisted as
    // itself and an operator can see exactly what the provider sent. SQL still
    // refuses it, because the comparison is exact and never case-folds.
    const resolved = route.resolveSuppressionType(
      suppressedEvent({ type: "onaccountsuppressionlist" }),
    );
    expect(resolved).toBe("onaccountsuppressionlist");
    expect(resolved).not.toBe("OnAccountSuppressionList");
  });

  test("the free-text message cannot influence classification", () => {
    const event = suppressedEvent({
      message: HOSTILE_MESSAGE,
      type: "SomeFutureSubtype",
    });

    // The message contains the documented token verbatim. Classification does
    // not care, because it never reads that field.
    expect(route.resolveSuppressionType(event)).toBe("SomeFutureSubtype");
    expect(route.resolveSuppressionType(event)).not.toBe(
      "OnAccountSuppressionList",
    );
  });

  test("the free-text message appears in no stored metadata", () => {
    const event = suppressedEvent({
      message: HOSTILE_MESSAGE,
      type: "OnAccountSuppressionList",
    });
    const metadata = metadataFor(event);
    const serialized = JSON.stringify(metadata);

    expect(metadata.suppressionType).toBe("OnAccountSuppressionList");
    // No key smuggles it under any name. 'suppressionReason' in particular is
    // absent by design: a *Reason* key invites free text into it.
    for (const forbiddenKey of [
      "suppressionMessage",
      "suppressionReason",
      "message",
    ]) {
      expect(Object.keys(metadata)).not.toContain(forbiddenKey);
    }
    for (const fragment of [
      "student@example.test",
      "DROP TABLE",
      "csf_communication_deliveries",
      "INFO fake log line",
    ]) {
      expect(serialized).not.toContain(fragment);
    }
  });

  test("the free-text message reaches neither the RPC arguments nor the logs", async () => {
    const raw = JSON.stringify(
      suppressedEvent({
        message: HOSTILE_MESSAGE,
        type: "OnAccountSuppressionList",
      }),
    );
    verifyImpl = () => JSON.parse(raw);

    const response = await route.POST(makeRequest(raw));
    expect(response.status).toBe(200);

    const recorded = rpcCalls.find(
      (call) => call.fn === "csf_record_communication_provider_event",
    );
    expect(recorded).toBeDefined();

    const rpcSerialized = JSON.stringify(recorded);
    const logSerialized = JSON.stringify(logged);
    const bodySerialized = await response.text();

    for (const fragment of [
      "student@example.test",
      "DROP TABLE",
      "csf_communication_deliveries",
      "INFO fake log line",
    ]) {
      expect(rpcSerialized).not.toContain(fragment);
      expect(logSerialized).not.toContain(fragment);
      expect(bodySerialized).not.toContain(fragment);
    }

    // The bounded token did travel, because SQL needs it to classify.
    expect(
      (recorded!.args.p_metadata as Record<string, unknown>).suppressionType,
    ).toBe("OnAccountSuppressionList");
  });

  test("an unrecognized subtype still travels as Unknown, never as absence", async () => {
    const raw = JSON.stringify(
      suppressedEvent({ message: HOSTILE_MESSAGE, type: { nested: true } }),
    );
    verifyImpl = () => JSON.parse(raw);

    await route.POST(makeRequest(raw));

    const recorded = rpcCalls.find(
      (call) => call.fn === "csf_record_communication_provider_event",
    );
    const metadata = recorded!.args.p_metadata as Record<string, unknown>;

    // "We looked and it was not a token" must stay distinguishable from "we
    // never looked": the SQL escalation path reports on exactly that difference.
    expect(metadata.suppressionType).toBe("Unknown");
  });

  test("non-suppression events carry no suppression key at all", () => {
    const delivered = {
      type: "email.delivered",
      created_at: "2032-04-01T10:00:00.000Z",
      data: {
        email_id: "synthetic-message-delivered",
        tags: csfTags(),
        // Even if the provider attached one, a delivered event is not a
        // suppression and must never be classified as one.
        suppressed: {
          type: "OnAccountSuppressionList",
          message: HOSTILE_MESSAGE,
        },
      },
    };

    expect(Object.keys(metadataFor(delivered))).not.toContain(
      "suppressionType",
    );
  });

  test("the signature is still verified against the raw body before any persistence", async () => {
    const raw = JSON.stringify(
      suppressedEvent({
        message: HOSTILE_MESSAGE,
        type: "OnAccountSuppressionList",
      }),
    );
    let rpcCallsAtVerify = -1;
    verifyImpl = () => {
      rpcCallsAtVerify = rpcCalls.length;
      return JSON.parse(raw);
    };

    await route.POST(makeRequest(raw));

    // Ordering, not merely presence: nothing was persisted before verify ran.
    expect(rpcCallsAtVerify).toBe(0);
    expect(verifyCalls).toHaveLength(1);
    expect(verifyCalls[0].payload).toBe(raw);
    expect(rpcCalls.length).toBeGreaterThan(0);
  });
});
