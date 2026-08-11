import { describe, expect, test } from "bun:test";

import {
  createProjectFeedbackToken,
  verifyProjectFeedbackToken,
} from "./project-feedback-token";

const SECRET = "a".repeat(48);
const OTHER_SECRET = "b".repeat(48);
const NOW = 1_800_000_000_000;
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

const identity = {
  projectId: "11111111-1111-4111-8111-111111111111",
  requestId: "22222222-2222-4222-8222-222222222222",
  subject: {
    kind: "user" as const,
    userId: "33333333-3333-4333-8333-333333333333",
  },
};

describe("project feedback token", () => {
  test("round-trips a user subject", () => {
    const token = createProjectFeedbackToken(identity, {
      now: NOW,
      secret: SECRET,
    });
    const payload = verifyProjectFeedbackToken(token, {
      now: NOW + 1000,
      secret: SECRET,
    });
    expect(payload).not.toBeNull();
    expect(payload?.projectId).toBe(identity.projectId);
    expect(payload?.requestId).toBe(identity.requestId);
    expect(payload?.subject).toEqual(identity.subject);
  });

  test("round-trips an anonymous subject", () => {
    const token = createProjectFeedbackToken(
      {
        ...identity,
        subject: { kind: "anonymous", anonymousSignupId: "anon-1" },
      },
      { now: NOW, secret: SECRET },
    );
    const payload = verifyProjectFeedbackToken(token, {
      now: NOW,
      secret: SECRET,
    });
    expect(payload?.subject).toEqual({
      kind: "anonymous",
      anonymousSignupId: "anon-1",
    });
  });

  test("rejects a tampered payload", () => {
    const token = createProjectFeedbackToken(identity, {
      now: NOW,
      secret: SECRET,
    });
    const [payloadPart, signature] = token.split(".");
    const decoded = JSON.parse(
      Buffer.from(payloadPart, "base64url").toString("utf8"),
    );
    decoded.requestId = "99999999-9999-4999-8999-999999999999";
    const forged = `${Buffer.from(JSON.stringify(decoded)).toString("base64url")}.${signature}`;
    expect(
      verifyProjectFeedbackToken(forged, { now: NOW, secret: SECRET }),
    ).toBeNull();
  });

  test("rejects a tampered signature and a wrong secret", () => {
    const token = createProjectFeedbackToken(identity, {
      now: NOW,
      secret: SECRET,
    });
    expect(
      verifyProjectFeedbackToken(`${token.split(".")[0]}.AAAA`, {
        now: NOW,
        secret: SECRET,
      }),
    ).toBeNull();
    expect(
      verifyProjectFeedbackToken(token, { now: NOW, secret: OTHER_SECRET }),
    ).toBeNull();
  });

  test("expires after 30 days exactly", () => {
    const token = createProjectFeedbackToken(identity, {
      now: NOW,
      secret: SECRET,
    });
    expect(
      verifyProjectFeedbackToken(token, {
        now: NOW + TTL_MS - 1,
        secret: SECRET,
      }),
    ).not.toBeNull();
    expect(
      verifyProjectFeedbackToken(token, { now: NOW + TTL_MS, secret: SECRET }),
    ).toBeNull();
  });

  test("rejects TTL drift in the payload", () => {
    const token = createProjectFeedbackToken(identity, {
      now: NOW,
      secret: SECRET,
    });
    const [payloadPart] = token.split(".");
    const decoded = JSON.parse(
      Buffer.from(payloadPart, "base64url").toString("utf8"),
    );
    decoded.expiresAt = decoded.expiresAt + 60_000;
    // Re-sign correctly so only the drift check can reject it.
    const { createHmac } =
      require("node:crypto") as typeof import("node:crypto");
    const reEncoded = Buffer.from(JSON.stringify(decoded)).toString(
      "base64url",
    );
    const reSigned = createHmac("sha256", SECRET)
      .update(`project-feedback:v1:${reEncoded}`)
      .digest("base64url");
    expect(
      verifyProjectFeedbackToken(`${reEncoded}.${reSigned}`, {
        now: NOW,
        secret: SECRET,
      }),
    ).toBeNull();
  });

  test("rejects a token issued in the future beyond clock skew", () => {
    const token = createProjectFeedbackToken(identity, {
      now: NOW + 60_000,
      secret: SECRET,
    });
    expect(
      verifyProjectFeedbackToken(token, { now: NOW, secret: SECRET }),
    ).toBeNull();
  });

  test("rejects malformed tokens", () => {
    expect(verifyProjectFeedbackToken(null, { secret: SECRET })).toBeNull();
    expect(verifyProjectFeedbackToken("", { secret: SECRET })).toBeNull();
    expect(
      verifyProjectFeedbackToken("one-part-only", { secret: SECRET }),
    ).toBeNull();
    expect(verifyProjectFeedbackToken("a.b.c", { secret: SECRET })).toBeNull();
  });
});
