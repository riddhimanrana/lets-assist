import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

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
