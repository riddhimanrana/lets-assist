import { format, isValid, parse } from "date-fns";
import type { EventType, ProjectSchedule } from "@/types";
import type {
  SignupGeniusImportPreview,
  SignupGeniusSignupSummary,
  SignupGeniusSlot,
} from "@/types/signupgenius";

const SIGNUP_GENIUS_BASE_URL = "https://api.signupgenius.com/v2/k";

interface SignupGeniusApiResponse<T> {
  success?: boolean;
  message?: string[] | string;
  data?: T;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getApiKey = () => {
  const key = process.env.SIGNUP_GENIUS_API_KEY;
  if (!key) {
    throw new Error("SIGNUP_GENIUS_API_KEY is not configured.");
  }
  return key;
};

const getString = (
  record: Record<string, unknown>,
  keys: string[]
): string | undefined => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return undefined;
};

const getNumber = (
  record: Record<string, unknown>,
  keys: string[]
): number | undefined => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
};

const normalizeDate = (value?: string): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(trimmed)) {
    const parsed = parse(trimmed, "M/d/yyyy", new Date());
    if (isValid(parsed)) {
      return format(parsed, "yyyy-MM-dd");
    }
  }

  if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(trimmed)) {
    const parsed = parse(trimmed, "yyyy/M/d", new Date());
    if (isValid(parsed)) {
      return format(parsed, "yyyy-MM-dd");
    }
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return format(parsed, "yyyy-MM-dd");
};

const normalizeTime = (value?: string): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();

  if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
    const [hours, minutes] = trimmed.split(":").map(Number);
    if (Number.isFinite(hours) && Number.isFinite(minutes)) {
      return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    }
  }

  if (/^\d{1,2}:\d{2}:\d{2}$/.test(trimmed)) {
    const [hours, minutes] = trimmed.split(":").map(Number);
    if (Number.isFinite(hours) && Number.isFinite(minutes)) {
      return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    }
  }

  const normalized = trimmed
    .replace(/\./g, "")
    .replace(/(am|pm)$/i, " $1")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

  const timeFormats = ["h:mm a", "hh:mm a", "h a", "hh a"];
  for (const formatStr of timeFormats) {
    const parsed = parse(normalized, formatStr, new Date());
    if (isValid(parsed)) {
      return format(parsed, "HH:mm");
    }
  }

  return undefined;
};

const parseDateTime = (
  value?: string
): { date?: string; time?: string } => {
  if (!value) return {};
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return {};
  }
  return {
    date: format(parsed, "yyyy-MM-dd"),
    time: format(parsed, "HH:mm"),
  };
};

async function fetchSignupGenius<T>(
  path: string,
  params?: Record<string, string>
): Promise<SignupGeniusApiResponse<T>> {
  const key = getApiKey();
  const url = new URL(`${SIGNUP_GENIUS_BASE_URL}${path}`);
  url.searchParams.set("user_key", key);

  if (params) {
    Object.entries(params).forEach(([paramKey, paramValue]) => {
      if (paramValue) {
        url.searchParams.set(paramKey, paramValue);
      }
    });
  }

  const response = await fetch(url.toString(), { cache: "no-store" });
  const text = await response.text();

  let payload: SignupGeniusApiResponse<T> | null = null;
  try {
    payload = JSON.parse(text) as SignupGeniusApiResponse<T>;
  } catch (error) {
    console.error("Failed to parse SignUpGenius response:", error, text);
  }

  if (!response.ok) {
    throw new Error(payload?.message?.toString() || "SignUpGenius request failed.");
  }

  if (!payload) {
    throw new Error("SignUpGenius returned an empty response.");
  }

  if (payload.success === false) {
    throw new Error(payload.message?.toString() || "SignUpGenius request failed.");
  }

  return payload;
}

export async function listSignupGeniusCreatedSignups(
  scope: "all" | "active" | "expired" = "all"
): Promise<SignupGeniusSignupSummary[]> {
  const response = await fetchSignupGenius<unknown[]>(
    `/signups/created/${scope}/`
  );

  const data = Array.isArray(response.data) ? response.data : [];
  return data.map((item) => normalizeSignupSummary(item));
}

export async function getSignupGeniusReport(
  signupId: string,
  scope: "all" | "available" | "filled" = "all"
): Promise<SignupGeniusApiResponse<unknown>> {
  return fetchSignupGenius<unknown>(`/signups/report/${scope}/${signupId}/`);
}

export function normalizeSignupSummary(
  raw: unknown
): SignupGeniusSignupSummary {
  const record = isRecord(raw) ? raw : {};
  return {
    id: getString(record, ["signupid", "signup_id", "id", "signupId"]) ||
      "unknown",
    title: getString(record, ["title", "signup_title", "name"]) || undefined,
    startDate: normalizeDate(
      getString(record, ["startdate", "start_date", "startDate"])
    ),
    endDate: normalizeDate(
      getString(record, ["enddate", "end_date", "endDate"])
    ),
    timezone: getString(record, ["timezone", "timezone_name", "tz"]) ||
      undefined,
    signupUrl: getString(record, ["signupurl", "signup_url", "url"]) ||
      undefined,
    raw: record,
  };
}

export function matchSignupByInput(
  input: string,
  signups: SignupGeniusSignupSummary[]
): SignupGeniusSignupSummary | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;

  if (/^\d+$/.test(trimmed)) {
    return signups.find((signup) => signup.id === trimmed);
  }

  if (trimmed.startsWith("http")) {
    try {
      const url = new URL(trimmed);
      const possibleId = url.searchParams.get("signupid") ||
        url.searchParams.get("signup_id") ||
        url.searchParams.get("id");
      if (possibleId) {
        return signups.find((signup) => signup.id === possibleId);
      }
    } catch {
      // ignore URL parse errors
    }

    return signups.find((signup) =>
      signup.signupUrl?.toLowerCase() === trimmed.toLowerCase()
    );
  }

  const lowered = trimmed.toLowerCase();
  return signups.find((signup) =>
    signup.title?.toLowerCase().includes(lowered)
  );
}

const findArrayByKeys = (
  value: unknown,
  keys: string[],
  depth: number = 0
): Record<string, unknown>[] | null => {
  if (depth > 4) return null;
  if (Array.isArray(value)) {
    const items = value.filter(isRecord);
    if (items.length > 0) {
      const hasKey = items.some((item) => keys.some((key) => key in item));
      if (hasKey) return items;
    }
    return null;
  }

  if (!isRecord(value)) return null;

  for (const item of Object.values(value)) {
    const result = findArrayByKeys(item, keys, depth + 1);
    if (result) return result;
  }

  return null;
};

const collectSlotsFromReport = (
  reportData: unknown,
  fallbackDate?: string
): SignupGeniusSlot[] => {
  const data = isRecord(reportData) && "data" in reportData
    ? (reportData as Record<string, unknown>).data
    : reportData;

  const record = isRecord(data) ? data : {};
  const directArrays = [
    record.itemlist,
    record.items,
    record.slots,
    record.item_list,
    record.slotlist,
  ];

  let items: Record<string, unknown>[] = [];
  for (const candidate of directArrays) {
    if (Array.isArray(candidate)) {
      items = candidate.filter(isRecord);
      if (items.length > 0) break;
    }
  }

  if (items.length === 0) {
    const found = findArrayByKeys(record, [
      "starttime",
      "endtime",
      "start_time",
      "end_time",
      "startdate",
      "enddate",
      "item",
      "title",
    ]);
    items = found ?? [];
  }

  return items.map((item) => {
    const raw = item;
    const title = getString(raw, ["item", "title", "name", "role"]);
    const date = normalizeDate(
      getString(raw, ["date", "startdate", "start_date", "startDate"]) ||
        fallbackDate
    );
    const startTime = normalizeTime(
      getString(raw, ["starttime", "start_time", "startTime"])
    );
    const endTime = normalizeTime(
      getString(raw, ["endtime", "end_time", "endTime"])
    );

    const startDateTime = getString(raw, [
      "startdatetime",
      "start_date_time",
      "startDateTime",
      "start",
    ]);
    const endDateTime = getString(raw, [
      "enddatetime",
      "end_date_time",
      "endDateTime",
      "end",
    ]);

    const parsedStart = parseDateTime(startDateTime);
    const parsedEnd = parseDateTime(endDateTime);

    const finalDate = date || parsedStart.date || parsedEnd.date || fallbackDate;
    const finalStartTime = startTime || parsedStart.time;
    const finalEndTime = endTime || parsedEnd.time;

    const quantity = getNumber(raw, [
      "quantity",
      "qty",
      "volunteers",
      "capacity",
      "needed",
      "need",
      "openings",
      "spots",
    ]);

    const filled = getNumber(raw, [
      "filled",
      "filledslots",
      "filled_slots",
      "taken",
      "signed_up",
      "signedup",
    ]);

    const slotsArray = Array.isArray(raw.slots) ? raw.slots : undefined;
    const quantityFromSlots =
      quantity ?? (slotsArray ? slotsArray.length : undefined);

    const filledFromSlots =
      filled ?? (slotsArray ? slotsArray.length : undefined);

    const remaining =
      quantityFromSlots && filledFromSlots !== undefined
        ? Math.max(0, quantityFromSlots - filledFromSlots)
        : undefined;

    return {
      id: getString(raw, ["itemid", "slotid", "id", "item_id"]),
      title: title || undefined,
      date: finalDate || undefined,
      startTime: finalStartTime || undefined,
      endTime: finalEndTime || undefined,
      quantity: quantityFromSlots,
      filled: filledFromSlots,
      remaining,
      raw,
    } satisfies SignupGeniusSlot;
  });
};

const toSchedule = (
  slots: SignupGeniusSlot[]
): { eventType: EventType; schedule: ProjectSchedule } => {
  const validSlots = slots.filter(
    (slot) => slot.date && slot.startTime && slot.endTime
  );

  const uniqueDates = Array.from(
    new Set(validSlots.map((slot) => slot.date))
  ).filter(Boolean) as string[];

  if (validSlots.length === 1) {
    const slot = validSlots[0];
    return {
      eventType: "oneTime",
      schedule: {
        oneTime: {
          date: slot.date!,
          startTime: slot.startTime!,
          endTime: slot.endTime!,
          volunteers: Math.max(1, slot.quantity ?? 1),
        },
      },
    };
  }

  if (uniqueDates.length === 1) {
    const sameDateSlots = validSlots.filter(
      (slot) => slot.date === uniqueDates[0]
    );

    const first = sameDateSlots[0];
    const hasUniformTimes = sameDateSlots.every(
      (slot) => slot.startTime === first.startTime && slot.endTime === first.endTime
    );

    if (hasUniformTimes) {
      const startTimes = sameDateSlots
        .map((slot) => slot.startTime!)
        .sort();
      const endTimes = sameDateSlots
        .map((slot) => slot.endTime!)
        .sort();

      return {
        eventType: "sameDayMultiArea",
        schedule: {
          sameDayMultiArea: {
            date: uniqueDates[0],
            overallStart: startTimes[0],
            overallEnd: endTimes[endTimes.length - 1],
            roles: sameDateSlots.map((slot, index) => ({
              name: slot.title || `Role ${index + 1}`,
              startTime: slot.startTime!,
              endTime: slot.endTime!,
              volunteers: Math.max(1, slot.quantity ?? 1),
            })),
          },
        },
      };
    }
  }

  const grouped: Record<string, SignupGeniusSlot[]> = {};
  validSlots.forEach((slot) => {
    const date = slot.date || "Unknown";
    grouped[date] = grouped[date] || [];
    grouped[date].push(slot);
  });

  const multiDay = Object.entries(grouped)
    .filter(([date]) => date !== "Unknown")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, daySlots]) => ({
      date,
      slots: daySlots
        .sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""))
        .map((slot) => ({
          startTime: slot.startTime!,
          endTime: slot.endTime!,
          volunteers: Math.max(1, slot.quantity ?? 1),
        })),
    }));

  return {
    eventType: "multiDay",
    schedule: {
      multiDay,
    },
  };
};

export function buildSignupGeniusPreview(
  signup: SignupGeniusSignupSummary,
  report: SignupGeniusApiResponse<unknown>
): SignupGeniusImportPreview {
  const warnings: string[] = [];
  const blockingIssues: string[] = [];

  const slots = collectSlotsFromReport(report, signup.startDate);

  if (slots.length === 0) {
    blockingIssues.push("No signup slots were found in the SignUpGenius report.");
  }

  const usableSlots = slots.filter(
    (slot) => slot.date && slot.startTime && slot.endTime
  );

  if (usableSlots.length === 0) {
    blockingIssues.push(
      "SignUpGenius data is missing date/time details for the signup slots."
    );
  }

  if (usableSlots.length < slots.length) {
    warnings.push(
      "Some slots were missing dates or times and were excluded from the preview."
    );
  }

  if (usableSlots.some((slot) => !slot.quantity)) {
    warnings.push(
      "Some slots are missing a capacity value; we will default those to 1 volunteer."
    );
  }

  const { eventType, schedule } = toSchedule(usableSlots);

  return {
    signup,
    eventType,
    schedule,
    slots: usableSlots,
    warnings,
    blockingIssues,
    suggestedVisibility: "unlisted",
  };
}
