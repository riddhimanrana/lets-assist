import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

/**
 * The server-only authoring and consent entrypoints.
 *
 * These wrappers exist because the durable ledger had no door: section J of
 * migration 20260730001003 revokes every write privilege on all ten
 * communications tables and grants service_role SELECT alone, and before this
 * correction there was no campaign INSERT entrypoint and no broadcast preference
 * INSERT/UPDATE entrypoint at all. A campaign could only be created by a test
 * fixture.
 *
 * What these tests pin is the SHAPE OF THE REQUEST the wrapper sends. Authority
 * itself is proved by the SECURITY DEFINER function -- deliberately not
 * re-implemented here, because a second, weaker copy of an authorization rule is
 * how the two drift apart. The corresponding 42501 cases are executable pgTAP in
 * supabase/tests/database/csf_durable_communications_contract.test.sql.
 *
 * Every fixture value is synthetic and uses reserved .test names.
 */

const campaign = await import("./csf-communications-campaign");

const ORG = "ce100000-0000-4000-8000-000000000001";
const ACTOR = "ce000000-0000-4000-8000-000000000001";
const CAMPAIGN = "ce400000-0000-4000-8000-000000000001";

type RpcCall = { fn: string; args: Record<string, unknown> };

function harness(
  handlers: Record<
    string,
    () => { data: unknown; error: { message: string; code?: string } | null }
  > = {},
) {
  const calls: RpcCall[] = [];
  return {
    calls,
    plugin: {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        const handler = handlers[fn];
        if (handler) return handler();
        return { data: {}, error: null };
      },
    },
  };
}

let lastCalls: RpcCall[] = [];

beforeEach(() => {
  lastCalls = [];
});

describe("creating a campaign draft", () => {
  test("the sender identity is not a parameter the caller can reach", async () => {
    const { calls, plugin } = harness({
      csf_create_communication_campaign_draft: () => ({
        data: { campaignId: CAMPAIGN, status: "draft", campaignKind: "broadcast" },
        error: null,
      }),
    });
    lastCalls = calls;

    const draft = await campaign.createCsfCampaignDraft(plugin, {
      organizationId: ORG,
      campaignKind: "broadcast",
      subject: "Spring 2032 partner club audit",
      bodyText: "Please submit your Spring 2032 audit.",
      actorUserId: ACTOR,
      broadcastTopicKey: "partner_clubs",
    });

    expect(draft.campaignId).toBe(CAMPAIGN);
    expect(draft.status).toBe("draft");

    // THE POINT. There is no p_sender_email, no p_sender_name, and no
    // p_reply_to_email in the request, so a caller cannot choose an arbitrary From
    // or Reply-To -- there is nowhere to put one.
    const args = calls[0].args;
    const argNames = Object.keys(args);
    expect(argNames).not.toContain("p_sender_email");
    expect(argNames).not.toContain("p_sender_name");
    expect(argNames).not.toContain("p_reply_to_email");
    expect(argNames).not.toContain("p_from");
    expect(argNames).not.toContain("p_reply_to");

    // Nor may a caller pre-declare the derived safety fields.
    expect(argNames).not.toContain("p_content_hash");
    expect(argNames).not.toContain("p_body_text_hash");
    expect(argNames).not.toContain("p_provider_idempotency_key");
    expect(argNames).not.toContain("p_status");
  });

  test("the actor and organization are always transmitted", async () => {
    const { calls, plugin } = harness();
    lastCalls = calls;

    await campaign.createCsfCampaignDraft(plugin, {
      organizationId: ORG,
      campaignKind: "transactional",
      subject: "Mandatory notice",
      bodyText: "This one cannot be refused.",
      actorUserId: ACTOR,
      termId: "ce200000-0000-4000-8000-000000000001",
      audienceKind: "applicants",
    });

    expect(calls[0].fn).toBe("csf_create_communication_campaign_draft");
    expect(calls[0].args).toMatchObject({
      p_organization_id: ORG,
      p_campaign_kind: "transactional",
      p_actor_user_id: ACTOR,
      // A transactional campaign carries no topic; it cannot be refused.
      p_broadcast_topic_key: null,
      p_resend_topic_id: null,
    });
  });

  test("a ledger refusal surfaces as a bounded fault, never the raw message", async () => {
    const { plugin } = harness({
      csf_create_communication_campaign_draft: () => ({
        data: null,
        error: {
          message:
            'permission denied for account csf-officer@local.test on organization row',
          code: "42501",
        },
      }),
    });

    let thrown: unknown;
    try {
      await campaign.createCsfCampaignDraft(plugin, {
        organizationId: ORG,
        campaignKind: "broadcast",
        subject: "Refused",
        bodyText: "Refused body.",
        actorUserId: ACTOR,
        broadcastTopicKey: "partner_clubs",
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    // The database names accounts and rows for an operator reading the log. None
    // of that may reach a caller -- not in the message, and not in the code.
    expect(JSON.stringify({
      message: String(thrown),
      code: (thrown as { code?: string }).code,
    })).not.toContain("csf-officer@local.test");
    // The SQLSTATE still travels, because a caller needs to tell "you may not do
    // this" apart from "the database was unreachable".
    expect((thrown as { code?: string }).code).toBe("42501");
  });
});

describe("updating a campaign draft", () => {
  test("only editable content is transmitted", async () => {
    const { calls, plugin } = harness({
      csf_update_communication_campaign_draft: () => ({
        data: { campaignId: CAMPAIGN, status: "draft", updated: true },
        error: null,
      }),
    });
    lastCalls = calls;

    const result = await campaign.updateCsfCampaignDraft(plugin, {
      organizationId: ORG,
      campaignId: CAMPAIGN,
      actorUserId: ACTOR,
      subject: "Revised subject",
      bodyText: "Revised body.",
    });

    expect(result.updated).toBe(true);

    const argNames = Object.keys(calls[0].args);
    // The identity of the send is not editable through this path at all.
    for (const forbidden of [
      "p_sender_email",
      "p_sender_name",
      "p_reply_to_email",
      "p_campaign_kind",
      "p_broadcast_topic_key",
      "p_resend_topic_id",
      "p_term_id",
      "p_audience_kind",
      "p_status",
      "p_content_hash",
    ]) {
      expect(argNames).not.toContain(forbidden);
    }
  });

  test("an immutable campaign refusal is surfaced, not swallowed", async () => {
    const { plugin } = harness({
      csf_update_communication_campaign_draft: () => ({
        data: null,
        error: { message: "campaign is queued", code: "23514" },
      }),
    });

    await expect(
      campaign.updateCsfCampaignDraft(plugin, {
        organizationId: ORG,
        campaignId: CAMPAIGN,
        actorUserId: ACTOR,
        subject: "Too late",
      }),
    ).rejects.toThrow();
  });
});

describe("recording a broadcast preference decision", () => {
  test("a recipient decision carries its address binding and names no account", async () => {
    const { calls, plugin } = harness({
      csf_record_broadcast_preference_decision: () => ({
        data: {
          organizationId: ORG,
          topicKey: "partner_clubs",
          recipientEmailHash: "f".repeat(64),
          subscriptionState: "unsubscribed",
          applied: true,
          created: true,
        },
        error: null,
      }),
    });
    lastCalls = calls;

    const result = await campaign.recordCsfBroadcastPreferenceDecision(plugin, {
      organizationId: ORG,
      topicKey: "partner_clubs",
      recipientEmail: "rep.one@local.test",
      decision: "opt_out",
      actorKind: "recipient",
      verifiedRecipientEmailHash: "f".repeat(64),
    });

    expect(result.subscriptionState).toBe("unsubscribed");
    expect(result.applied).toBe(true);
    // The hash, never the address, comes back.
    expect(result.recipientEmailHash).toBe("f".repeat(64));

    expect(calls[0].args).toMatchObject({
      p_actor_kind: "recipient",
      // A recipient decision names no staff account.
      p_actor_user_id: null,
      p_verified_recipient_email_hash: "f".repeat(64),
    });
  });

  test("a staff decision carries an account and a documented reason", async () => {
    const { calls, plugin } = harness();
    lastCalls = calls;

    await campaign.recordCsfBroadcastPreferenceDecision(plugin, {
      organizationId: ORG,
      topicKey: "partner_clubs",
      recipientEmail: "adviser@local.test",
      decision: "opt_out",
      actorKind: "staff",
      actorUserId: ACTOR,
      reason: "Adviser asked to be removed at the 2032 spring meeting.",
    });

    expect(calls[0].args).toMatchObject({
      p_actor_kind: "staff",
      p_actor_user_id: ACTOR,
      p_reason: "Adviser asked to be removed at the 2032 spring meeting.",
    });
  });

  test("the topic is always scoped and the transactional key is never sent", async () => {
    const { calls, plugin } = harness();
    lastCalls = calls;

    await campaign.recordCsfBroadcastPreferenceDecision(plugin, {
      organizationId: ORG,
      topicKey: "partner_clubs",
      recipientEmail: "rep.two@local.test",
      decision: "resubscribe",
      actorKind: "recipient",
      verifiedRecipientEmailHash: "a".repeat(64),
    });

    // BROADCAST CONSENT IS TOPIC-SCOPED. The request always names a topic, so it
    // can never express a decision about mandatory operational mail.
    expect(calls[0].args.p_topic_key).toBe("partner_clubs");
    expect(calls[0].args.p_topic_key).not.toBe("transactional");
    expect(Object.keys(calls[0].args)).toContain("p_topic_key");
  });

  test("a decision that did not apply is reported, not silently treated as success", async () => {
    const { plugin } = harness({
      csf_record_broadcast_preference_decision: () => ({
        data: {
          organizationId: ORG,
          topicKey: "partner_clubs",
          recipientEmailHash: "b".repeat(64),
          subscriptionState: "unsubscribed",
          applied: false,
          created: false,
          reason: "a_newer_decision_stands",
        },
        error: null,
      }),
    });

    const result = await campaign.recordCsfBroadcastPreferenceDecision(plugin, {
      organizationId: ORG,
      topicKey: "partner_clubs",
      recipientEmail: "rep.three@local.test",
      decision: "resubscribe",
      actorKind: "recipient",
      verifiedRecipientEmailHash: "b".repeat(64),
    });

    // A newer decision already stands. Reporting this as applied would let a
    // caller believe it had overwritten consent it did not.
    expect(result.applied).toBe(false);
    expect(result.reason).toBe("a_newer_decision_stands");
  });

  test("a provider decision is not a shape this wrapper can express", async () => {
    const { calls, plugin } = harness();
    lastCalls = calls;

    // A Resend event names an ADDRESS and a MESSAGE. It does not name a chapter
    // and it does not name a CSF topic, so no verified event can authorize
    // opting a given address out of a given topic. The draft that allowed it
    // accepted ANY verified event in the organization as authority over ANY
    // address and topic -- a check that looked like a binding and was not one.
    //
    // `actorKind` now admits two values and there is no provider-event field, so
    // this is a compile error rather than a runtime rejection. @ts-expect-error
    // fails the build if the hole is ever reopened, which is the assertion.
    await campaign.recordCsfBroadcastPreferenceDecision(plugin, {
      organizationId: ORG,
      topicKey: "partner_clubs",
      recipientEmail: "bounced@local.test",
      decision: "opt_out",
      // @ts-expect-error provider is not a CsfPreferenceActorKind
      actorKind: "provider",
    });

    // Even forced past the type system, no provider-event coordinate is ever
    // transmitted: the parameter does not exist on the RPC any more.
    expect(Object.keys(calls[0].args)).not.toContain("p_provider_event_row_id");
    expect(JSON.stringify(calls[0].args)).not.toContain("providerEventRowId");
  });

  test("no wrapper transmits a provider-event coordinate on any consent path", async () => {
    const { calls, plugin } = harness();
    lastCalls = calls;

    for (const actorKind of ["recipient", "staff"] as const) {
      await campaign.recordCsfBroadcastPreferenceDecision(plugin, {
        organizationId: ORG,
        topicKey: "partner_clubs",
        recipientEmail: "member@local.test",
        decision: "opt_out",
        actorKind,
        ...(actorKind === "staff"
          ? { actorUserId: ACTOR, reason: "Relaying a written request." }
          : { verifiedRecipientEmailHash: "c".repeat(64) }),
      });
    }

    for (const call of calls) {
      expect(Object.keys(call.args)).not.toContain("p_provider_event_row_id");
      expect(call.args.p_actor_kind).not.toBe("provider");
    }
    expect(lastCalls).toHaveLength(2);
  });
});

describe("the request surface as a whole", () => {
  test("no wrapper ever transmits a recipient address to a campaign RPC", async () => {
    const { calls, plugin } = harness();
    lastCalls = calls;

    await campaign.createCsfCampaignDraft(plugin, {
      organizationId: ORG,
      campaignKind: "broadcast",
      subject: "Audit",
      bodyText: "Body.",
      actorUserId: ACTOR,
      broadcastTopicKey: "partner_clubs",
    });
    await campaign.updateCsfCampaignDraft(plugin, {
      organizationId: ORG,
      campaignId: CAMPAIGN,
      actorUserId: ACTOR,
      subject: "Audit revised",
    });

    // Addressing is the recipient snapshot's job, under its own authorized RPC.
    // The authoring path never carries one.
    expect(JSON.stringify(calls)).not.toContain("@local.test");
    expect(lastCalls).toHaveLength(2);
  });
});
