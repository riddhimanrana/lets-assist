import "server-only";
import { googleCalendarEventUrl } from "@/lib/google-calendar-identifiers";
export type ProviderEventResult = "confirmed" | "missing" | "unconfirmed";

export async function writeOrganizationCalendarEvent(
  options: {
    accessToken: string;
    calendarId: string;
    eventId: string;
    receiptId: string;
    create: boolean;
    event: Record<string, unknown>;
    beforeWrite?: () => Promise<unknown>;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderEventResult> {
  const headers = {
    Authorization: `Bearer ${options.accessToken}`,
    "Content-Type": "application/json",
  };
  const extended = options.event.extendedProperties as
    { private?: Record<string, unknown> } | undefined;
  const payload = {
    ...options.event,
    id: options.eventId,
    extendedProperties: {
      ...extended,
      private: { ...extended?.private, letsAssistReceipt: options.receiptId },
    },
  };
  const request = (method: string, etag?: string) =>
    fetchImpl(
      googleCalendarEventUrl(
        options.calendarId,
        method === "POST" ? undefined : options.eventId,
      ),
      {
        method,
        headers: { ...headers, ...(etag ? { "If-Match": etag } : {}) },
        ...(method === "GET" ? {} : { body: JSON.stringify(payload) }),
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      },
    );
  try {
    if (options.create) {
      await options.beforeWrite?.();
      const response = await request("POST");
      if (response.ok) return "confirmed";
      if (response.status !== 409) return "unconfirmed";
    }
    const lookup = await request("GET");
    if (lookup.status === 404 || lookup.status === 410) return "missing";
    if (!lookup.ok) return "unconfirmed";
    const value = (await lookup.json()) as {
      id?: unknown;
      etag?: unknown;
      status?: unknown;
      extendedProperties?: { private?: { letsAssistReceipt?: unknown } };
    };
    if (value.id !== options.eventId) return "unconfirmed";
    if (value.status === "cancelled") return "missing";
    const marker = value.extendedProperties?.private?.letsAssistReceipt;
    if (
      !["confirmed", "tentative"].includes(String(value.status)) ||
      (options.create
        ? marker !== options.receiptId
        : marker !== undefined && marker !== options.receiptId) ||
      typeof value.etag !== "string" ||
      value.etag.length === 0 ||
      value.etag.length > 1024
    )
      return "unconfirmed";
    await options.beforeWrite?.();
    const update = await request("PUT", value.etag);
    if (update.ok) return "confirmed";
    return update.status === 404 || update.status === 410
      ? "missing"
      : "unconfirmed";
  } catch {
    return "unconfirmed";
  }
}
