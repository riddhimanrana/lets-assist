import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { SendEmailParams } from "@/services/email";

mock.module("server-only", () => ({}));

/**
 * Step one of the verify-the-address unsubscribe loop. Two properties are under
 * test and they pull in opposite directions.
 *
 * The response is constant. A member's address, a stranger's, a rate-limited
 * repeat, and an internal failure all produce the same state, so the form does
 * not report who receives chapter mail.
 *
 * The send is not constant. A confirmation email leaves only when the typed
 * address has appeared in this chapter's recipient snapshots, so the chapter's
 * sender identity cannot be aimed at arbitrary mailboxes.
 *
 * Since the first property hides everything, the second is observable only
 * through the transport. So the snapshot stub implements real predicate
 * semantics, `eq` exact and `ilike` as LIKE with `%` and `_` wildcards, rather
 * than recording which builder method was called. A membership check written
 * with `ilike` passes a typed `m_mber@example.test` against a stored
 * `member@example.test` and mails a stranger. The wildcard cases below pin that
 * down.
 *
 * Every fixture is synthetic and uses reserved .test addresses. No database is
 * reached and no provider is called.
 */

const ORG = "bd100000-0000-4000-8000-000000000001";
const TOPIC = "chapter_announcements";
const CAMPAIGN = "bd100000-0000-4000-8000-000000000002";
let organizationName: string | null = "Example High CSF";
let campaignReplyTo: string | null = "chapter@example.test";
let identityReadFails = false;
const previousOrganizationSender = process.env.ORGANIZATION_EMAIL_FROM;
process.env.ORGANIZATION_EMAIL_FROM =
  "Let's Assist <updates@notifications.lets-assist.com>";
afterAll(() => {
  if (previousOrganizationSender === undefined)
    delete process.env.ORGANIZATION_EMAIL_FROM;
  else process.env.ORGANIZATION_EMAIL_FROM = previousOrganizationSender;
});

function identityQuery(table: "organizations" | "csf_communication_campaigns") {
  const filters = new Map<string, unknown>();
  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      filters.set(column, value);
      return builder;
    },
    maybeSingle: async () => {
      const scoped =
        table === "organizations"
          ? filters.get("id") === ORG
          : filters.get("organization_id") === ORG &&
            filters.get("id") === CAMPAIGN;
      return {
        data:
          scoped && !identityReadFails
            ? table === "organizations"
              ? { name: organizationName }
              : { reply_to_email: campaignReplyTo }
            : null,
        error: identityReadFails ? { message: "Unavailable" } : null,
      };
    },
  };
  return builder;
}

/** Rows the chapter has actually snapshotted, in the shape the table stores. */
let snapshotRows: Array<{ id: string; recipient_email: string }> = [];

function normalized(row: { recipient_email: string }) {
  return row.recipient_email.trim().toLowerCase();
}

/** `%` matches any run, `_` matches exactly one character. Everything else is literal. */
function likeMatches(pattern: string, value: string) {
  const expression = pattern.replace(/[.*+?^${}()|[\]\\%_]/gu, (character) =>
    character === "%" ? ".*" : character === "_" ? "." : `\\${character}`,
  );
  return new RegExp(`^${expression}$`, "iu").test(value);
}

type Filter = (row: { id: string; recipient_email: string }) => boolean;

function snapshotQuery() {
  const filters: Filter[] = [];
  const builder = {
    select: () => builder,
    eq(column: string, value: unknown) {
      if (column === "organization_id") {
        filters.push(() => value === ORG);
      } else if (column === "normalized_recipient_email") {
        filters.push((row) => normalized(row) === value);
      } else if (column === "recipient_email") {
        filters.push((row) => row.recipient_email === value);
      } else {
        throw new Error(`Unexpected snapshot filter column: ${column}`);
      }
      return builder;
    },
    ilike(column: string, value: string) {
      if (column === "normalized_recipient_email") {
        filters.push((row) => likeMatches(value, normalized(row)));
      } else if (column === "recipient_email") {
        filters.push((row) => likeMatches(value, row.recipient_email));
      } else {
        throw new Error(`Unexpected snapshot filter column: ${column}`);
      }
      return builder;
    },
    limit(count: number) {
      const matched = snapshotRows
        .filter((row) => filters.every((filter) => filter(row)))
        .slice(0, count);
      return Promise.resolve({
        data: matched.map((row) => ({ ...row, campaign_id: CAMPAIGN })),
        error: null,
      });
    },
  };
  return builder;
}

mock.module("@/lib/plugins/supabase", () => ({
  createPluginAdminClient: () => ({
    from: (table: string) => {
      if (table === "csf_communication_campaigns") return identityQuery(table);
      if (table !== "csf_communication_recipient_snapshots") {
        throw new Error(`Unexpected table read: ${table}`);
      }
      return snapshotQuery();
    },
  }),
}));

/** Rate-limit buckets that answer `allowed` until a test says otherwise. */
let rateLimitAllows = true;
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      if (table !== "organizations")
        throw new Error("Unexpected organization query");
      return identityQuery(table);
    },
    rpc: async () => ({
      data: [{ allowed: rateLimitAllows }],
      error: null,
    }),
  }),
}));

const sent: Array<{
  to: SendEmailParams["to"];
  type: SendEmailParams["type"];
}> = [];
const sentMessages: SendEmailParams[] = [];
mock.module("@/services/email-send", () => ({
  sendEmail: async (message: SendEmailParams) => {
    sentMessages.push(message);
    sent.push({ to: message.to, type: message.type });
    return { success: true };
  },
}));

mock.module("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7" }),
}));

process.env.CSF_UNSUBSCRIBE_TOKEN_SECRET =
  "synthetic-unsubscribe-secret-value-0123456789";
process.env.NEXT_PUBLIC_SITE_URL = "https://example.test";

const { requestCsfUnsubscribeAction } = await import("./actions");

function submit(email: string) {
  const form = new FormData();
  form.append("organizationId", ORG);
  form.append("topicKey", TOPIC);
  form.append("email", email);
  return requestCsfUnsubscribeAction({ submitted: false }, form);
}

beforeEach(() => {
  snapshotRows = [
    { id: "row-1", recipient_email: "john@example.test" },
    { id: "row-2", recipient_email: "Ada.Lovelace@Example.test" },
  ];
  sent.length = 0;
  sentMessages.length = 0;
  rateLimitAllows = true;
  organizationName = "Example High CSF";
  campaignReplyTo = "chapter@example.test";
  identityReadFails = false;
});

describe("CSF unsubscribe request step", () => {
  test("mails a confirmation to an address the chapter has snapshotted", async () => {
    expect(await submit("john@example.test")).toEqual({ submitted: true });
    expect(sent).toEqual([{ to: "john@example.test", type: "transactional" }]);
  });

  test("uses the organization sender, name, and campaign Reply-To", async () => {
    expect(await submit("john@example.test")).toEqual({ submitted: true });
    expect(sentMessages[0]).toMatchObject({
      from: "Example High CSF <updates@notifications.lets-assist.com>",
      replyTo: "chapter@example.test",
      react: { props: { chapterName: "Example High CSF" } },
    });
  });

  for (const missing of ["organization", "replyTo", "readFailure"] as const) {
    test(`keeps the neutral response and sends nothing for ${missing}`, async () => {
      if (missing === "organization") organizationName = null;
      if (missing === "replyTo") campaignReplyTo = null;
      if (missing === "readFailure") identityReadFails = true;
      expect(await submit("john@example.test")).toEqual({ submitted: true });
      expect(sentMessages).toEqual([]);
    });
  }

  test("matches a snapshot stored with different casing", async () => {
    // The form lowercases what was typed; the stored column is generated as
    // lower(btrim(...)). Both sides normalize, so the two meet.
    expect(await submit("ADA.LOVELACE@example.TEST")).toEqual({
      submitted: true,
    });
    expect(sent).toEqual([
      { to: "ada.lovelace@example.test", type: "transactional" },
    ]);
  });

  test("does not mail an address the chapter has never snapshotted", async () => {
    expect(await submit("stranger@example.test")).toEqual({ submitted: true });
    expect(sent).toEqual([]);
  });

  test("treats `_` as a literal, not a single-character wildcard", async () => {
    // `_` is a legal local-part character that this form's validator accepts.
    // Under `ilike`, `jo_n` matched the stored `john@example.test` and mailed
    // an address that is not one of the chapter's recipients.
    expect(await submit("jo_n@example.test")).toEqual({ submitted: true });
    expect(sent).toEqual([]);
  });

  test("never lets a wildcard local part stand in for a real recipient", async () => {
    snapshotRows = [{ id: "row-1", recipient_email: "member@example.test" }];
    for (const typed of [
      "m_mber@example.test",
      "membe_@example.test",
      "_ember@example.test",
    ]) {
      expect(await submit(typed)).toEqual({ submitted: true });
    }
    expect(sent).toEqual([]);
  });

  test("answers the same way when the rate limiter refuses", async () => {
    rateLimitAllows = false;
    expect(await submit("john@example.test")).toEqual({ submitted: true });
    // The limiter protects the mailbox and the sender; it reports nothing, and
    // it stops the send before the snapshot is even consulted.
    expect(sent).toEqual([]);
  });

  test("rejects a malformed address before any work", async () => {
    expect(await submit("not-an-address")).toEqual({
      submitted: false,
      error: "Enter a valid email address.",
    });
    expect(sent).toEqual([]);
  });

  test("refuses the reserved transactional topic", async () => {
    const form = new FormData();
    form.append("organizationId", ORG);
    form.append("topicKey", "transactional");
    form.append("email", "john@example.test");
    expect(
      await requestCsfUnsubscribeAction({ submitted: false }, form),
    ).toEqual({
      submitted: false,
      error: "Enter a valid email address.",
    });
    expect(sent).toEqual([]);
  });
});
