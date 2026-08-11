import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { createCsfUnsubscribeToken, verifyCsfUnsubscribeToken } = await import(
  "./csf-unsubscribe-token"
);

const SECRET = "0123456789abcdef0123456789abcdef";
const identity = {
  organizationId: "be100000-0000-4000-8000-000000000001",
  topicKey: "announcements",
  recipientEmail: "Member.One@Local.Test",
};

describe("CSF unsubscribe tokens", () => {
  test("a minted token verifies and normalizes the address", () => {
    const token = createCsfUnsubscribeToken(identity, { secret: SECRET });
    const payload = verifyCsfUnsubscribeToken(token, { secret: SECRET });
    expect(payload).toMatchObject({
      organizationId: identity.organizationId,
      topicKey: identity.topicKey,
      recipientEmail: "member.one@local.test",
    });
  });

  test("expiry is enforced at exactly the 30-minute boundary", () => {
    const now = 1_750_000_000_000;
    const token = createCsfUnsubscribeToken(identity, { secret: SECRET, now });
    expect(
      verifyCsfUnsubscribeToken(token, {
        secret: SECRET,
        now: now + 30 * 60 * 1000 - 1,
      }),
    ).not.toBeNull();
    expect(
      verifyCsfUnsubscribeToken(token, {
        secret: SECRET,
        now: now + 30 * 60 * 1000,
      }),
    ).toBeNull();
  });

  test("a tampered payload fails the signature", () => {
    const token = createCsfUnsubscribeToken(identity, { secret: SECRET });
    const [encoded, signature] = token.split(".");
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    );
    payload.recipientEmail = "victim@local.test";
    const forged = `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${signature}`;
    expect(verifyCsfUnsubscribeToken(forged, { secret: SECRET })).toBeNull();
  });

  test("a token minted under one secret never verifies under another", () => {
    const token = createCsfUnsubscribeToken(identity, { secret: SECRET });
    expect(
      verifyCsfUnsubscribeToken(token, { secret: `${SECRET}different-secret` }),
    ).toBeNull();
  });

  test("garbage input is rejected without throwing", () => {
    expect(verifyCsfUnsubscribeToken(null, { secret: SECRET })).toBeNull();
    expect(verifyCsfUnsubscribeToken("", { secret: SECRET })).toBeNull();
    expect(
      verifyCsfUnsubscribeToken("not-a-token", { secret: SECRET }),
    ).toBeNull();
    expect(
      verifyCsfUnsubscribeToken("a.b.c", { secret: SECRET }),
    ).toBeNull();
  });
});
