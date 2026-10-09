import "server-only";
import { googleCalendarEventUrl } from "@/lib/google-calendar-identifiers";
import { verifyOwnedLegacyCalendar } from "./destination";
import type { PersonalCalendarEvent } from "./reconcile";

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
    const response = await fetchImpl(googleCalendarEventUrl(calendarId), {
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

/** Keep proof within one reconciliation and one exact token/calendar pair. */
export function createPersonalCalendarEventRemover(
  fetchImpl: typeof fetch = fetch,
) {
  const proofs = new Map<string, Promise<boolean>>();
  return async (
    accessToken: string,
    calendarId: string,
    id: string,
  ): Promise<boolean> => {
    try {
      const key = JSON.stringify([accessToken, calendarId]);
      let proof = proofs.get(key);
      if (!proof) {
        proof = verifyOwnedLegacyCalendar(
          accessToken,
          calendarId,
          fetchImpl,
        ).then((state) => state === "owned");
        proofs.set(key, proof);
      }
      if (!(await proof)) return false;
      const response = await fetchImpl(googleCalendarEventUrl(calendarId, id), {
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
