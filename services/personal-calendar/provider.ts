import "server-only";
import { googleCalendarEventUrl } from "@/lib/google-calendar-identifiers";
import { verifyOwnedLegacyCalendar } from "./destination";
import type { PersonalCalendarEvent } from "./reconcile";

/** Personal entries have no guests to notify; say so explicitly on every mutation. */
function mutationUrl(calendarId: string, eventId?: string) {
  return `${googleCalendarEventUrl(calendarId, eventId)}?sendUpdates=none`;
}

export async function createPersonalCalendarEvent(
  accessToken: string,
  calendarId: string,
  id: string,
  event: PersonalCalendarEvent,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
  try {
    const response = await fetchImpl(mutationUrl(calendarId), {
      method: "POST",
      headers,
      body: JSON.stringify({ ...event, id }),
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
    if (response.ok) return true;
    if (response.status !== 409) return false;
    const lookup = await fetchImpl(googleCalendarEventUrl(calendarId, id), {
      headers,
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
    if (!lookup.ok) return false;
    const existing: unknown = await lookup.json();
    if (!existing || typeof existing !== "object") return false;
    const candidate = existing as {
      id?: unknown;
      status?: unknown;
      extendedProperties?: { private?: { letsAssistReceipt?: unknown } };
    };
    // Google GET can return tombstones with 200, so existence alone is insufficient.
    return (
      candidate.id === id &&
      ["confirmed", "tentative"].includes(String(candidate.status)) &&
      candidate.extendedProperties?.private?.letsAssistReceipt ===
        event.extendedProperties?.private?.letsAssistReceipt
    );
  } catch {
    return false;
  }
}

export async function removePersonalCalendarEvent(
  accessToken: string,
  calendarId: string,
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  return createPersonalCalendarEventRemover(fetchImpl)(
    accessToken,
    calendarId,
    id,
  );
}

type OwnershipProofs = Map<string, Promise<boolean>>;

function ownedCalendarProof(
  proofs: OwnershipProofs,
  accessToken: string,
  calendarId: string,
  fetchImpl: typeof fetch,
) {
  const key = JSON.stringify([accessToken, calendarId]);
  let proof = proofs.get(key);
  if (!proof) {
    proof = verifyOwnedLegacyCalendar(accessToken, calendarId, fetchImpl).then(
      (state) => state === "owned",
    );
    proofs.set(key, proof);
  }
  return proof;
}

type ProviderEvent = Record<string, unknown> & {
  extendedProperties?: { private?: { letsAssistReceipt?: unknown } };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Google GET can return tombstones with 200, so existence alone is insufficient. */
function liveEvent(value: unknown, id: string): ProviderEvent | null {
  if (!isRecord(value)) return null;
  return value.id === id &&
    ["confirmed", "tentative"].includes(String(value.status))
    ? (value as ProviderEvent)
    : null;
}

const receiptMarker = (event: ProviderEvent) =>
  event.extendedProperties?.private?.letsAssistReceipt;

/** An unconditional PUT could overwrite a concurrent change, so a usable ETag is required. */
const usableEtag = (value: unknown): value is string =>
  typeof value === "string" && /^[\x21-\x7E]{1,1024}$/.test(value);

const WALL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?$/;
const ABSOLUTE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function zoneOffset(epoch: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(epoch));
  const part = (type: string) =>
    Number(parts.find((entry) => entry.type === type)?.value);
  return (
    Date.UTC(
      part("year"),
      part("month") - 1,
      part("day"),
      part("hour"),
      part("minute"),
      part("second"),
    ) - epoch
  );
}

/** The instant a Google dateTime names: an explicit offset wins, else the wall time in its zone. */
function instantOf(dateTime: unknown, timeZone: unknown): number | null {
  if (typeof dateTime !== "string") return null;
  if (ABSOLUTE_TIME.test(dateTime)) {
    const value = Date.parse(dateTime);
    return Number.isFinite(value) ? value : null;
  }
  const wall = WALL_TIME.exec(dateTime);
  if (!wall || typeof timeZone !== "string") return null;
  try {
    const local = Date.UTC(
      Number(wall[1]),
      Number(wall[2]) - 1,
      Number(wall[3]),
      Number(wall[4]),
      Number(wall[5]),
      Number(wall[6]),
    );
    const guess = local - zoneOffset(local, timeZone);
    // A second pass settles wall times next to a daylight-saving change.
    const value = local - zoneOffset(guess, timeZone);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function sameMoment(actual: unknown, desired: PersonalCalendarEvent["start"]) {
  if (!isRecord(actual)) return false;
  if ("date" in desired) return actual.date === desired.date;
  const wanted = instantOf(desired.dateTime, desired.timeZone);
  // Google may answer in the calendar's zone, so compare instants, not strings.
  return (
    wanted !== null &&
    wanted ===
      instantOf(actual.dateTime, actual.timeZone ?? desired.timeZone) &&
    (actual.timeZone === undefined || actual.timeZone === desired.timeZone)
  );
}

/** Strict on purpose: a mismatch only costs another idempotent PUT of the same payload. */
function reflectsSavedPayload(
  current: ProviderEvent,
  event: PersonalCalendarEvent,
) {
  return (
    receiptMarker(current) ===
      event.extendedProperties?.private?.letsAssistReceipt &&
    current.summary === event.summary &&
    (current.description ?? "") === (event.description ?? "") &&
    (current.location ?? "") === (event.location ?? "") &&
    sameMoment(current.start, event.start) &&
    sameMoment(current.end, event.end)
  );
}

/** Fields this app renders from the project. Everything else on the event belongs to Google or the user. */
const APP_OWNED_FIELDS = [
  "summary",
  "description",
  "location",
  "start",
  "end",
  "reminders",
  "source",
];

/**
 * events.update replaces the whole resource, so start from what Google
 * returned and replace only the app-owned fields with the saved payload.
 */
function mergedResource(
  current: ProviderEvent,
  id: string,
  event: PersonalCalendarEvent,
) {
  const { extendedProperties, ...owned } = event;
  const body: Record<string, unknown> = { ...current };
  for (const field of APP_OWNED_FIELDS) delete body[field];
  delete body.etag;
  const existing: Record<string, unknown> = isRecord(current.extendedProperties)
    ? current.extendedProperties
    : {};
  return {
    ...body,
    ...owned,
    id,
    extendedProperties: {
      ...existing,
      private: {
        ...(isRecord(existing.private) ? existing.private : {}),
        ...extendedProperties?.private,
      },
    },
  };
}

/**
 * Rewrite one saved event ID in place. A missing, deleted or foreign event is
 * an incomplete update: it is never recreated, cleared or moved.
 *
 * `beforeWrite` runs after the ownership and event lookups and immediately
 * before the PUT, so the caller can recheck authority that those lookups may
 * have outlived. If it rejects, nothing is written.
 */
export function createPersonalCalendarEventUpdater(
  fetchImpl: typeof fetch = fetch,
) {
  const proofs: OwnershipProofs = new Map();
  return async (
    accessToken: string,
    calendarId: string,
    id: string,
    event: PersonalCalendarEvent,
    options: { legacy?: boolean; beforeWrite?: () => Promise<unknown> } = {},
  ): Promise<boolean> => {
    try {
      const receipt = event.extendedProperties?.private?.letsAssistReceipt;
      if (!receipt) return false;
      if (
        !(await ownedCalendarProof(proofs, accessToken, calendarId, fetchImpl))
      )
        return false;
      const url = googleCalendarEventUrl(calendarId, id);
      const authorization = { Authorization: `Bearer ${accessToken}` };
      const read = async () => {
        const response = await fetchImpl(url, {
          headers: authorization,
          signal: AbortSignal.timeout(10_000),
          redirect: "error",
        });
        return response.ok ? liveEvent(await response.json(), id) : null;
      };
      // An uncertain write is proven only by the exact saved payload on the same live event.
      const readback = async () => {
        const after = await read();
        return Boolean(after && reflectsSavedPayload(after, event));
      };
      const current = await read();
      if (!current) return false;
      const marker = receiptMarker(current);
      // Only the one stored legacy ID may predate receipt markers.
      if (marker !== receipt && !(options.legacy && marker === undefined))
        return false;
      const etag = current.etag;
      if (!usableEtag(etag)) return false;
      const body = JSON.stringify(mergedResource(current, id, event));
      await options.beforeWrite?.();
      let response: Response;
      try {
        response = await fetchImpl(mutationUrl(calendarId, id), {
          method: "PUT",
          headers: {
            ...authorization,
            "Content-Type": "application/json",
            "If-Match": etag,
          },
          body,
          signal: AbortSignal.timeout(10_000),
          redirect: "error",
        });
      } catch {
        return await readback();
      }
      if (response.ok) {
        const saved = liveEvent(await response.json().catch(() => null), id);
        // Google's own answer is the result; an unreadable one falls back to a readback.
        return saved ? reflectsSavedPayload(saved, event) : await readback();
      }
      if (response.status === 429 || response.status >= 500)
        return await readback();
      return false;
    } catch {
      return false;
    }
  };
}

/**
 * Keep proof within one reconciliation and one exact token/calendar pair.
 * `beforeWrite` runs after the ownership proof and immediately before the
 * DELETE; if it rejects, nothing is deleted.
 */
export function createPersonalCalendarEventRemover(
  fetchImpl: typeof fetch = fetch,
) {
  const proofs: OwnershipProofs = new Map();
  return async (
    accessToken: string,
    calendarId: string,
    id: string,
    beforeWrite?: () => Promise<unknown>,
  ): Promise<boolean> => {
    try {
      if (
        !(await ownedCalendarProof(proofs, accessToken, calendarId, fetchImpl))
      )
        return false;
      await beforeWrite?.();
      const response = await fetchImpl(mutationUrl(calendarId, id), {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10_000),
        redirect: "error",
      });
      return response.ok || response.status === 404 || response.status === 410;
    } catch {
      return false;
    }
  };
}
