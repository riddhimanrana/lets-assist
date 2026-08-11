import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Post-project feedback links (modelled on services/csf-unsubscribe-token.ts).
 *
 * The follow-up email's rating and unsubscribe links carry this token as the
 * whole authorization: the bearer can rate the one project the request row
 * points at, as the one recipient it was mailed to — nothing else.
 * Deliberately NOT anonymous_signups.token: that is a non-expiring capability
 * over the volunteer's entire anonymous profile, and putting it in a survey
 * email would widen its blast radius to every mail forward and link scanner.
 *
 * TTL is 30 days: a survey link has to survive a real inbox, unlike the CSF
 * unsubscribe token whose 30 minutes exist because it records a preference
 * change immediately.
 */

const FEEDBACK_TOKEN_VERSION = 1;
const FEEDBACK_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MINIMUM_SECRET_LENGTH = 32;

export type ProjectFeedbackTokenSubject =
  | { kind: "user"; userId: string }
  | { kind: "anonymous"; anonymousSignupId: string };

export type ProjectFeedbackTokenIdentity = {
  projectId: string;
  /** project_feedback_requests.id */
  requestId: string;
  subject: ProjectFeedbackTokenSubject;
};

export type ProjectFeedbackTokenPayload = ProjectFeedbackTokenIdentity & {
  version: typeof FEEDBACK_TOKEN_VERSION;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
};

function getFeedbackTokenSecret() {
  const secret =
    process.env.PROJECT_FEEDBACK_TOKEN_SECRET ?? process.env.ENCRYPTION_KEY;

  if (!secret || secret.length < MINIMUM_SECRET_LENGTH) {
    throw new Error(
      "PROJECT_FEEDBACK_TOKEN_SECRET or ENCRYPTION_KEY must be at least 32 characters.",
    );
  }

  return secret;
}

function signPayload(encodedPayload: string, secret: string) {
  return createHmac("sha256", secret)
    .update(`project-feedback:v${FEEDBACK_TOKEN_VERSION}:${encodedPayload}`)
    .digest("base64url");
}

function safelyEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function isSubject(value: unknown): value is ProjectFeedbackTokenSubject {
  if (!value || typeof value !== "object") return false;
  const subject = value as {
    kind?: unknown;
    userId?: unknown;
    anonymousSignupId?: unknown;
  };
  if (subject.kind === "user") {
    return typeof subject.userId === "string" && subject.userId.length > 0;
  }
  if (subject.kind === "anonymous") {
    return (
      typeof subject.anonymousSignupId === "string" &&
      subject.anonymousSignupId.length > 0
    );
  }
  return false;
}

function isTokenPayload(value: unknown): value is ProjectFeedbackTokenPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<ProjectFeedbackTokenPayload>;
  return (
    payload.version === FEEDBACK_TOKEN_VERSION &&
    typeof payload.projectId === "string" &&
    payload.projectId.length > 0 &&
    typeof payload.requestId === "string" &&
    payload.requestId.length > 0 &&
    isSubject(payload.subject) &&
    typeof payload.nonce === "string" &&
    payload.nonce.length >= 32 &&
    typeof payload.issuedAt === "number" &&
    Number.isSafeInteger(payload.issuedAt) &&
    typeof payload.expiresAt === "number" &&
    Number.isSafeInteger(payload.expiresAt)
  );
}

export function createProjectFeedbackToken(
  identity: ProjectFeedbackTokenIdentity,
  options: { now?: number; secret?: string; nonce?: string } = {},
) {
  const issuedAt = options.now ?? Date.now();
  const payload: ProjectFeedbackTokenPayload = {
    version: FEEDBACK_TOKEN_VERSION,
    projectId: identity.projectId,
    requestId: identity.requestId,
    subject: identity.subject,
    nonce: options.nonce ?? randomBytes(32).toString("base64url"),
    issuedAt,
    expiresAt: issuedAt + FEEDBACK_TOKEN_TTL_MS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  const signature = signPayload(
    encodedPayload,
    options.secret ?? getFeedbackTokenSecret(),
  );
  return `${encodedPayload}.${signature}`;
}

/**
 * Verify with no expected identity: the token IS the request. Callers act
 * only on the returned payload's project/request/subject triple.
 */
export function verifyProjectFeedbackToken(
  token: string | null | undefined,
  options: { now?: number; secret?: string } = {},
): ProjectFeedbackTokenPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  try {
    const [encodedPayload, suppliedSignature] = parts;
    const expectedSignature = signPayload(
      encodedPayload,
      options.secret ?? getFeedbackTokenSecret(),
    );
    if (!safelyEqual(suppliedSignature, expectedSignature)) return null;

    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as unknown;
    if (!isTokenPayload(payload)) return null;

    const now = options.now ?? Date.now();
    if (
      payload.issuedAt > now + 30_000 ||
      payload.expiresAt <= now ||
      payload.expiresAt - payload.issuedAt !== FEEDBACK_TOKEN_TTL_MS
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}
