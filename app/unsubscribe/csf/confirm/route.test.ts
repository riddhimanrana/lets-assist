import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

/**
 * THE UNSUBSCRIBE CONFIRMATION IS FETCHED BY MACHINES BEFORE IT IS SEEN BY A PERSON.
 *
 * This URL arrives by email, and inbound mail security scanners -- Microsoft
 * Defender Safe Links detonation, Proofpoint URL Defense, Barracuda -- fetch every
 * link they find before the recipient opens the message. While the mutation lived
 * in GET, the scanner recorded the opt-out, and the append-only decision history
 * attributed it to `recipient`: a consent record naming a person who never acted.
 *
 * That was reachable deliberately, not just by accident. Step one of the loop
 * accepts any address from an anonymous visitor and mails the token to it whenever
 * the address appears in a chapter's recipient snapshot -- so anyone who knew a
 * member's address could have the confirmation delivered to that member's mailbox
 * and let the mailbox's own scanner do the unsubscribing. Nothing in the request
 * distinguishes a scanner's GET from the recipient's.
 *
 * Every fixture is synthetic and uses reserved .test addresses. No email is sent
 * and no database is reached: the plugin client is a recording stub.
 */

type RpcCall = { fn: string; args: Record<string, unknown> };
const rpcCalls: RpcCall[] = [];
let rpcResult: { data: unknown; error: { message: string } | null } = {
  data: null,
  error: null,
};

mock.module("@/lib/plugins/supabase", () => ({
  createPluginAdminClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return rpcResult;
    },
  }),
}));

process.env.CSF_UNSUBSCRIBE_TOKEN_SECRET =
  "synthetic-unsubscribe-secret-value-0123456789";

const route = await import("./route");
const { createCsfUnsubscribeToken } =
  await import("@/services/csf-unsubscribe-token");
const { NextRequest } = await import("next/server");

const ORG = "bd100000-0000-4000-8000-000000000001";
const RECIPIENT = "member@example.test";

function token() {
  return createCsfUnsubscribeToken({
    organizationId: ORG,
    topicKey: "chapter_announcements",
    recipientEmail: RECIPIENT,
  });
}

function getRequest(query: string) {
  return new NextRequest(
    `https://example.test/unsubscribe/csf/confirm?${query}`,
  );
}

function postForm(fields: Record<string, string>) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.append(key, value);
  return new NextRequest("https://example.test/unsubscribe/csf/confirm", {
    method: "POST",
    body,
  });
}

/** The ledger's answer, in the shape the RPC returns it. */
function ledgerSays(state: "subscribed" | "unsubscribed", applied: boolean) {
  rpcResult = {
    data: {
      organizationId: ORG,
      topicKey: "chapter_announcements",
      recipientEmailHash: "0".repeat(64),
      subscriptionState: state,
      applied,
      created: false,
    },
    error: null,
  };
}

beforeEach(() => {
  rpcCalls.length = 0;
  ledgerSays("unsubscribed", true);
});

describe("GET renders a confirmation and records nothing", () => {
  test("a valid opt-out link writes no decision", async () => {
    const response = await route.GET(getRequest(`token=${token()}`));
    const html = await response.text();

    // THE ASSERTION THE DEFECT WAS ABOUT. A scanner's fetch must leave the
    // recipient's consent exactly as it found it.
    expect(rpcCalls).toHaveLength(0);
    expect(response.status).toBe(200);
    expect(html).toContain('<form method="post"');
  });

  test("the resubscribe variant is equally inert", async () => {
    await route.GET(getRequest(`token=${token()}&decision=resubscribe`));
    expect(rpcCalls).toHaveLength(0);
  });

  test("the page carries the token in a hidden field, not in the form action", async () => {
    // Keeps the bearer secret out of the referrer and the history entry the
    // submit would otherwise create.
    const issued = token();
    const html = await route
      .GET(getRequest(`token=${issued}`))
      .then((r) => r.text());

    expect(html).toContain(`name="token" value="${issued}"`);
    expect(html).toContain('action="/unsubscribe/csf/confirm"');
    expect(html).not.toContain(`action="/unsubscribe/csf/confirm?token=`);
  });

  test("an expired or forged token is told so, and still writes nothing", async () => {
    const response = await route.GET(getRequest("token=not-a-real-token"));

    expect(rpcCalls).toHaveLength(0);
    expect(await response.text()).toContain("invalid or has expired");
  });

  test("the recipient address is never rendered into the page", async () => {
    // The token's bearer already knows the address, but the page is fetched by
    // scanners and can end up in proxy logs and browser history.
    const html = await route
      .GET(getRequest(`token=${token()}`))
      .then((r) => r.text());
    expect(html).not.toContain(RECIPIENT);
  });

  test("valid and invalid token pages are private and never cacheable", async () => {
    const responses = [
      await route.GET(getRequest(`token=${token()}`)),
      await route.GET(getRequest("token=not-a-real-token")),
    ];

    for (const response of responses) {
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
  });
});

describe("POST records the decision the recipient actually made", () => {
  test("a submitted opt-out reaches the ledger as a recipient decision", async () => {
    const response = await route.POST(
      postForm({ token: token(), decision: "opt_out" }),
    );

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe("csf_record_broadcast_preference_decision");
    expect(rpcCalls[0].args).toMatchObject({
      p_organization_id: ORG,
      p_topic_key: "chapter_announcements",
      p_recipient_email: RECIPIENT,
      p_decision: "opt_out",
      p_actor_kind: "recipient",
    });
    // The verified-address hash is what lets the ledger accept a `recipient`
    // decision at all.
    expect(rpcCalls[0].args.p_verified_recipient_email_hash).toMatch(
      /^[0-9a-f]{64}$/,
    );
    expect(await response.text()).toContain("no longer receive");
  });

  test("the identity comes from the signed token, never from the form", async () => {
    // The form fields are attacker-controlled; the token is not. A post naming a
    // different organization, topic, or address must be ignored on all three.
    await route.POST(
      postForm({
        token: token(),
        decision: "opt_out",
        organizationId: "bd100000-0000-4000-8000-000000000999",
        topicKey: "attacker_topic",
        recipientEmail: "victim@example.test",
      }),
    );

    expect(rpcCalls[0].args.p_organization_id).toBe(ORG);
    expect(rpcCalls[0].args.p_topic_key).toBe("chapter_announcements");
    expect(rpcCalls[0].args.p_recipient_email).toBe(RECIPIENT);
  });

  test("a post with no valid token writes nothing", async () => {
    const response = await route.POST(
      postForm({ token: "forged", decision: "opt_out" }),
    );

    expect(rpcCalls).toHaveLength(0);
    expect(await response.text()).toContain("invalid or has expired");
  });

  test("an unrecognized decision value falls back to opt_out, not to a free string", async () => {
    await route.POST(postForm({ token: token(), decision: "delete_account" }));
    expect(rpcCalls[0].args.p_decision).toBe("opt_out");
  });

  test("successful, invalid, and failed submissions are private and never cacheable", async () => {
    const successful = await route.POST(
      postForm({ token: token(), decision: "opt_out" }),
    );
    const invalid = await route.POST(
      postForm({ token: "forged", decision: "opt_out" }),
    );
    rpcResult = { data: null, error: { message: "synthetic outage" } };
    const failed = await route.POST(
      postForm({ token: token(), decision: "opt_out" }),
    );

    for (const response of [successful, invalid, failed]) {
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
  });
});

/**
 * WHAT THE PAGE SAYS MUST BE WHAT THE LEDGER STORED.
 *
 * The RPC can succeed and decline to apply: a staff resubscribe committing with a
 * later decision timestamp wins, and the call returns `applied: false` with the
 * standing state. The page echoed the REQUESTED decision back regardless, so a
 * recipient could be told "you will no longer receive chapter announcements" while
 * the ledger had them subscribed and the next campaign mailed them.
 */
describe("the confirmation reports the ledger's verdict, not the request", () => {
  test("a refused opt-out says so instead of claiming success", async () => {
    ledgerSays("subscribed", false);

    const html = await route
      .POST(postForm({ token: token(), decision: "opt_out" }))
      .then((r) => r.text());

    expect(html).not.toContain("no longer receive");
    expect(html).toContain("took precedence");
    // And the page still offers the action, so a recipient who meant it can
    // simply try again.
    expect(html).toContain('name="decision" value="opt_out"');
  });

  test("a refused resubscribe says the address is still unsubscribed", async () => {
    ledgerSays("unsubscribed", false);

    const html = await route
      .POST(postForm({ token: token(), decision: "resubscribe" }))
      .then((r) => r.text());

    expect(html).toContain("still unsubscribed");
    expect(html).toContain('name="decision" value="resubscribe"');
  });

  test("an applied resubscribe confirms plainly", async () => {
    // The positive control. Without it, "report the ledger" could be satisfied by
    // never confirming anything.
    ledgerSays("subscribed", true);

    const html = await route
      .POST(postForm({ token: token(), decision: "resubscribe" }))
      .then((r) => r.text());

    // Escaped on the way out, which is itself the contract for this page.
    expect(html).toContain("You&#39;re resubscribed");
    expect(html).not.toContain("took precedence");
  });

  test("a ledger outage does not claim the choice was recorded", async () => {
    rpcResult = { data: null, error: { message: "connection terminated" } };

    const html = await route
      .POST(postForm({ token: token(), decision: "opt_out" }))
      .then((r) => r.text());

    expect(html).toContain("Something went wrong");
    // The raw database text is not rendered to a member.
    expect(html).not.toContain("connection terminated");
  });
});
