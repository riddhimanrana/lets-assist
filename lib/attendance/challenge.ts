import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { TZDate } from "@date-fns/tz";

import type { Project } from "@/types";
import {
  getMultiDaySlotByScheduleId,
  resolveScheduleId,
} from "@/utils/project";

const TOKEN_VERSION = 1;
const QR_CHALLENGE_MAX_TTL_MS = 12 * 60 * 60 * 1000;
const PRESENCE_TTL_MS = 5 * 60 * 1000;
const CHECKOUT_CAPABILITY_MAX_TTL_MS = 24 * 60 * 60 * 1000;
const QR_EARLY_WINDOW_MS = 2 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 30 * 1000;
const DEFAULT_PROJECT_TIMEZONE = "America/Los_Angeles";
const MINIMUM_SECRET_LENGTH = 32;

type AttendanceTokenKind = "qr" | "presence" | "checkout";

type BaseAttendanceToken = {
  version: typeof TOKEN_VERSION;
  kind: AttendanceTokenKind;
  projectId: string;
  sessionId: string;
  scheduleId: string;
  nonce: string;
  issuedAt: number;
  notBefore: number;
  expiresAt: number;
};

export type AttendanceQrChallenge = BaseAttendanceToken & {
  kind: "qr";
};

export type AttendancePresence = BaseAttendanceToken & {
  kind: "presence";
  qrNonce: string;
};

export type AttendanceCheckoutCapability = BaseAttendanceToken & {
  kind: "checkout";
  signupId: string;
  anonymousSignupId: string;
};

export type AttendanceScheduleWindow = {
  scheduleId: string;
  startsAt: number;
  endsAt: number;
};

type VerificationFailure = {
  ok: false;
  reason:
    | "missing_token"
    | "invalid_token"
    | "not_active"
    | "expired"
    | "binding_mismatch";
};

type VerificationResult<T> = { ok: true; payload: T } | VerificationFailure;

function getAttendanceSecret(): string {
  const secret =
    process.env.ATTENDANCE_CHALLENGE_SECRET ?? process.env.ENCRYPTION_KEY;

  if (!secret || secret.length < MINIMUM_SECRET_LENGTH) {
    throw new Error(
      "ATTENDANCE_CHALLENGE_SECRET or ENCRYPTION_KEY must be at least 32 characters long",
    );
  }

  return secret;
}

function sign(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`lets-assist-attendance:v${TOKEN_VERSION}:${encodedPayload}`)
    .digest("base64url");
}

function safelyEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function encodeToken(
  payload:
    AttendanceQrChallenge | AttendancePresence | AttendanceCheckoutCapability,
  secret: string,
): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  return `${encodedPayload}.${sign(encodedPayload, secret)}`;
}

function isBaseAttendanceToken(value: unknown): value is BaseAttendanceToken {
  if (!value || typeof value !== "object") {
    return false;
  }

  const token = value as Partial<BaseAttendanceToken>;
  return (
    token.version === TOKEN_VERSION &&
    (token.kind === "qr" ||
      token.kind === "presence" ||
      token.kind === "checkout") &&
    typeof token.projectId === "string" &&
    token.projectId.length > 0 &&
    typeof token.sessionId === "string" &&
    token.sessionId.length > 0 &&
    typeof token.scheduleId === "string" &&
    token.scheduleId.length > 0 &&
    token.scheduleId.length <= 256 &&
    typeof token.nonce === "string" &&
    token.nonce.length >= 32 &&
    typeof token.issuedAt === "number" &&
    Number.isSafeInteger(token.issuedAt) &&
    typeof token.notBefore === "number" &&
    Number.isSafeInteger(token.notBefore) &&
    typeof token.expiresAt === "number" &&
    Number.isSafeInteger(token.expiresAt) &&
    token.issuedAt <= token.expiresAt &&
    token.notBefore <= token.expiresAt
  );
}

function decodeAndVerifyToken(
  token: string | null | undefined,
  secret: string,
): VerificationResult<
  AttendanceQrChallenge | AttendancePresence | AttendanceCheckoutCapability
> {
  if (!token) {
    return { ok: false, reason: "missing_token" };
  }

  const parts = token.split(".");
  if (parts.length !== 2) {
    return { ok: false, reason: "invalid_token" };
  }

  const [encodedPayload, suppliedSignature] = parts;

  try {
    if (!safelyEqual(suppliedSignature, sign(encodedPayload, secret))) {
      return { ok: false, reason: "invalid_token" };
    }

    const parsed = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as unknown;

    if (!isBaseAttendanceToken(parsed)) {
      return { ok: false, reason: "invalid_token" };
    }

    if (parsed.kind === "presence") {
      const presence = parsed as Partial<AttendancePresence>;
      if (
        typeof presence.qrNonce !== "string" ||
        presence.qrNonce.length < 32
      ) {
        return { ok: false, reason: "invalid_token" };
      }
    }

    if (parsed.kind === "checkout") {
      const capability = parsed as Partial<AttendanceCheckoutCapability>;
      if (
        typeof capability.signupId !== "string" ||
        capability.signupId.length === 0 ||
        typeof capability.anonymousSignupId !== "string" ||
        capability.anonymousSignupId.length === 0
      ) {
        return { ok: false, reason: "invalid_token" };
      }
    }

    return {
      ok: true,
      payload: parsed as
        | AttendanceQrChallenge
        | AttendancePresence
        | AttendanceCheckoutCapability,
    };
  } catch {
    return { ok: false, reason: "invalid_token" };
  }
}

function verifyBinding(
  payload: BaseAttendanceToken,
  expected: {
    projectId?: string;
    sessionId?: string;
    scheduleId?: string;
  },
): boolean {
  return (
    (!expected.projectId ||
      safelyEqual(payload.projectId, expected.projectId)) &&
    (!expected.sessionId ||
      safelyEqual(payload.sessionId, expected.sessionId)) &&
    (!expected.scheduleId ||
      safelyEqual(payload.scheduleId, expected.scheduleId))
  );
}

function verifyActiveWindow(
  payload: BaseAttendanceToken,
  now: number,
): VerificationFailure | null {
  if (now + CLOCK_SKEW_MS < payload.notBefore) {
    return { ok: false, reason: "not_active" };
  }
  if (now >= payload.expiresAt) {
    return { ok: false, reason: "expired" };
  }
  return null;
}

function buildProjectDateTime(
  date: string,
  time: string,
  timezone: string,
): number | null {
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  if ([year, month, day, hours, minutes].some((value) => Number.isNaN(value))) {
    return null;
  }

  try {
    return new TZDate(
      year,
      month - 1,
      day,
      hours,
      minutes,
      0,
      timezone,
    ).getTime();
  } catch {
    return null;
  }
}

export function listAttendanceScheduleIds(project: Project): string[] {
  if (project.event_type === "oneTime" && project.schedule.oneTime) {
    return ["oneTime"];
  }

  if (project.event_type === "multiDay" && project.schedule.multiDay) {
    return project.schedule.multiDay.flatMap((day, dayIndex) =>
      day.slots.map((_, slotIndex) => `${day.date}-${dayIndex}-${slotIndex}`),
    );
  }

  if (
    project.event_type === "sameDayMultiArea" &&
    project.schedule.sameDayMultiArea
  ) {
    return project.schedule.sameDayMultiArea.roles.map((role) => role.name);
  }

  return [];
}

export function getAttendanceScheduleWindow(
  project: Project,
  incomingScheduleId: string,
): AttendanceScheduleWindow | null {
  const scheduleId = resolveScheduleId(project, incomingScheduleId);
  const timezone = project.project_timezone || DEFAULT_PROJECT_TIMEZONE;
  let date: string | null = null;
  let startTime: string | null = null;
  let endTime: string | null = null;

  if (project.event_type === "oneTime" && project.schedule.oneTime) {
    if (scheduleId !== "oneTime") return null;
    date = project.schedule.oneTime.date;
    startTime = project.schedule.oneTime.startTime;
    endTime = project.schedule.oneTime.endTime;
  } else if (project.event_type === "multiDay") {
    const slot = getMultiDaySlotByScheduleId(project, scheduleId);
    if (!slot) return null;
    date = slot.day.date;
    startTime = slot.slot.startTime;
    endTime = slot.slot.endTime;
  } else if (
    project.event_type === "sameDayMultiArea" &&
    project.schedule.sameDayMultiArea
  ) {
    const role = project.schedule.sameDayMultiArea.roles.find(
      (candidate) => candidate.name === scheduleId,
    );
    if (!role) return null;
    date = project.schedule.sameDayMultiArea.date;
    startTime = role.startTime;
    endTime = role.endTime;
  }

  if (!date || !startTime || !endTime) {
    return null;
  }

  const startsAt = buildProjectDateTime(date, startTime, timezone);
  let endsAt = buildProjectDateTime(date, endTime, timezone);
  if (startsAt === null || endsAt === null) {
    return null;
  }

  if (endsAt <= startsAt) {
    endsAt += 24 * 60 * 60 * 1000;
  }

  return { scheduleId, startsAt, endsAt };
}

export function createAttendanceQrChallenge(
  input: {
    projectId: string;
    sessionId: string;
    scheduleId: string;
    startsAt: number;
    endsAt: number;
  },
  options: { now?: number; secret?: string; nonce?: string } = {},
): { token: string; payload: AttendanceQrChallenge } {
  const now = options.now ?? Date.now();
  const secret = options.secret ?? getAttendanceSecret();
  const payload: AttendanceQrChallenge = {
    version: TOKEN_VERSION,
    kind: "qr",
    projectId: input.projectId,
    sessionId: input.sessionId,
    scheduleId: input.scheduleId,
    nonce: options.nonce ?? randomBytes(32).toString("base64url"),
    issuedAt: now,
    notBefore: input.startsAt - QR_EARLY_WINDOW_MS,
    expiresAt: Math.min(input.endsAt, now + QR_CHALLENGE_MAX_TTL_MS),
  };

  if (payload.expiresAt <= payload.notBefore) {
    throw new Error("Attendance schedule has no valid QR challenge window");
  }

  return { token: encodeToken(payload, secret), payload };
}

export function verifyAttendanceQrChallenge(
  token: string | null | undefined,
  expected: {
    projectId?: string;
    sessionId?: string;
    scheduleId?: string;
  } = {},
  options: { now?: number; secret?: string } = {},
): VerificationResult<AttendanceQrChallenge> {
  const secret = options.secret ?? getAttendanceSecret();
  const decoded = decodeAndVerifyToken(token, secret);
  if (!decoded.ok) return decoded;
  if (decoded.payload.kind !== "qr") {
    return { ok: false, reason: "invalid_token" };
  }
  const payload = decoded.payload as AttendanceQrChallenge;

  const windowError = verifyActiveWindow(payload, options.now ?? Date.now());
  if (windowError) return windowError;
  if (!verifyBinding(payload, expected)) {
    return { ok: false, reason: "binding_mismatch" };
  }

  return { ok: true, payload };
}

export function createAttendancePresence(
  qrChallenge: AttendanceQrChallenge,
  options: { now?: number; secret?: string; nonce?: string } = {},
): { token: string; payload: AttendancePresence } {
  const now = options.now ?? Date.now();
  const secret = options.secret ?? getAttendanceSecret();
  const payload: AttendancePresence = {
    version: TOKEN_VERSION,
    kind: "presence",
    projectId: qrChallenge.projectId,
    sessionId: qrChallenge.sessionId,
    scheduleId: qrChallenge.scheduleId,
    nonce: options.nonce ?? randomBytes(32).toString("base64url"),
    qrNonce: qrChallenge.nonce,
    issuedAt: now,
    notBefore: now,
    expiresAt: Math.min(now + PRESENCE_TTL_MS, qrChallenge.expiresAt),
  };

  if (payload.expiresAt <= now) {
    throw new Error("QR challenge expired before presence could be issued");
  }

  return { token: encodeToken(payload, secret), payload };
}

export function verifyAttendancePresence(
  token: string | null | undefined,
  expected: {
    projectId?: string;
    sessionId?: string;
    scheduleId?: string;
  } = {},
  options: { now?: number; secret?: string } = {},
): VerificationResult<AttendancePresence> {
  const secret = options.secret ?? getAttendanceSecret();
  const decoded = decodeAndVerifyToken(token, secret);
  if (!decoded.ok) return decoded;
  if (decoded.payload.kind !== "presence") {
    return { ok: false, reason: "invalid_token" };
  }
  const payload = decoded.payload as AttendancePresence;

  const windowError = verifyActiveWindow(payload, options.now ?? Date.now());
  if (windowError) return windowError;
  if (!verifyBinding(payload, expected)) {
    return { ok: false, reason: "binding_mismatch" };
  }

  return { ok: true, payload };
}

export function createAttendanceCheckoutCapability(
  input: {
    projectId: string;
    sessionId: string;
    scheduleId: string;
    signupId: string;
    anonymousSignupId: string;
    expiresAt: number;
  },
  options: { now?: number; secret?: string; nonce?: string } = {},
): { token: string; payload: AttendanceCheckoutCapability } {
  const now = options.now ?? Date.now();
  const secret = options.secret ?? getAttendanceSecret();
  const payload: AttendanceCheckoutCapability = {
    version: TOKEN_VERSION,
    kind: "checkout",
    projectId: input.projectId,
    sessionId: input.sessionId,
    scheduleId: input.scheduleId,
    signupId: input.signupId,
    anonymousSignupId: input.anonymousSignupId,
    nonce: options.nonce ?? randomBytes(32).toString("base64url"),
    issuedAt: now,
    notBefore: now,
    expiresAt: Math.min(input.expiresAt, now + CHECKOUT_CAPABILITY_MAX_TTL_MS),
  };

  if (payload.expiresAt <= now) {
    throw new Error("Attendance checkout capability has no valid window");
  }

  return { token: encodeToken(payload, secret), payload };
}

export function verifyAttendanceCheckoutCapability(
  token: string | null | undefined,
  expected: {
    projectId?: string;
    sessionId?: string;
    scheduleId?: string;
    signupId?: string;
    anonymousSignupId?: string;
  } = {},
  options: { now?: number; secret?: string } = {},
): VerificationResult<AttendanceCheckoutCapability> {
  const secret = options.secret ?? getAttendanceSecret();
  const decoded = decodeAndVerifyToken(token, secret);
  if (!decoded.ok) return decoded;
  if (decoded.payload.kind !== "checkout") {
    return { ok: false, reason: "invalid_token" };
  }
  const payload = decoded.payload as AttendanceCheckoutCapability;

  const windowError = verifyActiveWindow(payload, options.now ?? Date.now());
  if (windowError) return windowError;
  if (
    !verifyBinding(payload, expected) ||
    (expected.signupId && !safelyEqual(payload.signupId, expected.signupId)) ||
    (expected.anonymousSignupId &&
      !safelyEqual(payload.anonymousSignupId, expected.anonymousSignupId))
  ) {
    return { ok: false, reason: "binding_mismatch" };
  }

  return { ok: true, payload };
}

export function getAttendancePresenceCookieName(projectId: string): string {
  return `lets_assist_attendance_${projectId}`;
}

export function getAttendancePresenceCookieOptions(projectId: string) {
  return {
    httpOnly: true,
    path: `/attend/${projectId}`,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge: PRESENCE_TTL_MS / 1000,
  };
}

export function getAttendanceCheckoutCookieName(projectId: string): string {
  return `lets_assist_attendance_checkout_${projectId}`;
}

export function getAttendanceCheckoutCookieOptions(projectId: string) {
  return {
    httpOnly: true,
    path: `/attend/${projectId}`,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge: CHECKOUT_CAPABILITY_MAX_TTL_MS / 1000,
  };
}
