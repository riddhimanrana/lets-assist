import { SignUpGeniusImportError as ImportError } from "@/lib/signupgenius/errors";
import {
  importPreviewSchema,
  type ImportPreview,
} from "@/lib/signupgenius/model";
import { readSourceDateTime } from "@/lib/signupgenius/timing";
import { canonicalSignUpGeniusUrl } from "@/lib/signupgenius/url";
import { publicEventText } from "./signupgenius-jsonld-source";

type Node = Record<string, unknown>;
const object = (value: unknown): value is Node =>
  !!value && typeof value === "object" && !Array.isArray(value);
const schemaTerm = (value: unknown, term: string) =>
  value === term ||
  value === `https://schema.org/${term}` ||
  value === `http://schema.org/${term}`;
const context = (value: unknown) =>
  [
    "https://schema.org",
    "https://schema.org/",
    "http://schema.org",
    "http://schema.org/",
  ].includes(value as string);

function checkContext(node: Node, inherited: boolean): boolean {
  if ("@context" in node) {
    if (!context(node["@context"])) throw new ImportError("unsupported");
    return true;
  }
  return inherited;
}

function checkEvent(event: Node, inherited = true) {
  if (
    !checkContext(event, inherited) ||
    !schemaTerm(event["@type"], "Event") ||
    "@graph" in event
  )
    throw new ImportError("unsupported");
  if (
    "eventSchedule" in event ||
    "repeatFrequency" in event ||
    "recurrence" in event ||
    "previousStartDate" in event ||
    "subEvents" in event
  )
    throw new ImportError("unsupported");
  if (
    "eventStatus" in event &&
    !schemaTerm(event.eventStatus, "EventScheduled")
  )
    throw new ImportError("unsupported");
  if (
    "remainingAttendeeCapacity" in event &&
    "maximumAttendeeCapacity" in event &&
    (!Number.isSafeInteger(event.remainingAttendeeCapacity) ||
      (event.remainingAttendeeCapacity as number) < 0 ||
      (event.remainingAttendeeCapacity as number) >
        (event.maximumAttendeeCapacity as number))
  )
    throw new ImportError("incomplete");
}

function locationText(value: unknown): string {
  if (typeof value === "string") return publicEventText(value);
  if (value === undefined || value === null) return "";
  if (!object(value) || !checkContext(value, true))
    throw new ImportError("unsupported");
  if (schemaTerm(value["@type"], "PostalAddress")) {
    return [
      "streetAddress",
      "addressLocality",
      "addressRegion",
      "postalCode",
      "addressCountry",
    ]
      .map((key) => {
        if (value[key] !== undefined && typeof value[key] !== "string")
          throw new ImportError("unsupported");
        return publicEventText(value[key]);
      })
      .filter(Boolean)
      .join(", ");
  }
  if (
    !schemaTerm(value["@type"], "Place") &&
    !schemaTerm(value["@type"], "VirtualLocation")
  )
    throw new ImportError("unsupported");
  const name = publicEventText(value.name);
  const address =
    value.address === undefined ? "" : locationText(value.address);
  return [name, address].filter(Boolean).join(", ");
}

function timing(event: Node, allowSpan = false) {
  const start = readSourceDateTime(event.startDate),
    end = readSourceDateTime(event.endDate);
  if (!start || !end) throw new ImportError("incomplete");
  if (
    end.date < start.date ||
    (!allowSpan && start.date !== end.date) ||
    (start.date === end.date && end.time <= start.time) ||
    (start.offset === null) !== (end.offset === null) ||
    (start.instant !== null &&
      end.instant !== null &&
      end.instant <= start.instant)
  )
    throw new ImportError("incomplete");
  return { start, end };
}

/** A deliberately narrow Schema.org Event subset. This does not assert SUG emits JSON-LD. */
export function projectJsonLdEvent(
  documents: unknown[],
  sourceInput: string,
): ImportPreview {
  const sourceUrl = canonicalSignUpGeniusUrl(sourceInput);
  const roots: Node[] = [];
  const visit = (value: unknown, inherited = false) => {
    if (Array.isArray(value)) {
      for (const child of value) visit(child, inherited);
      return;
    }
    if (!object(value)) throw new ImportError("unsupported");
    const trustedContext = checkContext(value, inherited);
    if (schemaTerm(value["@type"], "Event")) {
      if (!trustedContext || "@graph" in value)
        throw new ImportError("unsupported");
      roots.push(value);
    } else if ("@graph" in value) {
      if (!trustedContext || !Array.isArray(value["@graph"]))
        throw new ImportError("unsupported");
      visit(value["@graph"], trustedContext);
    }
    // In particular: do not traverse attendee, organizer, Person, contact, or @id.
  };
  for (const document of documents) visit(document);
  if (roots.length !== 1) throw new ImportError("unsupported");
  const event = roots[0];
  checkEvent(event);
  if (event.url !== undefined) {
    try {
      if (canonicalSignUpGeniusUrl(event.url) !== sourceUrl) throw new Error();
    } catch {
      throw new ImportError("unsupported");
    }
  }
  const title = publicEventText(event.name),
    description = publicEventText(event.description);
  let location = locationText(event.location);
  const children =
    event.subEvent === undefined
      ? [event]
      : Array.isArray(event.subEvent)
        ? event.subEvent
        : [event.subEvent];
  if (!children.length || children.length > 100)
    throw new ImportError(children.length > 100 ? "too_large" : "incomplete");
  if (!location) {
    const childLocations = children.map((child) => {
      if (!object(child)) throw new ImportError("unsupported");
      return locationText(child.location);
    });
    const nonempty = childLocations.filter(Boolean);
    if (
      new Set(nonempty).size > 1 ||
      (nonempty.length && nonempty.length !== children.length)
    )
      throw new ImportError("unsupported");
    location = nonempty[0] ?? "";
  }
  const parentTiming =
    event.subEvent === undefined
      ? null
      : "startDate" in event || "endDate" in event
        ? timing(event, true)
        : null;
  const slots = children.map((child) => {
    if (!object(child)) throw new ImportError("unsupported");
    checkEvent(child);
    if (child !== event && "subEvent" in child)
      throw new ImportError("unsupported");
    const times = timing(child);
    if (parentTiming) {
      const comparable = (a: typeof times.start, b: typeof times.start) => {
        if ((a.instant === null) !== (b.instant === null))
          throw new ImportError("incomplete");
        return a.instant !== null && b.instant !== null
          ? a.instant - b.instant
          : `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`);
      };
      if (
        comparable(times.start, parentTiming.start) < 0 ||
        comparable(times.end, parentTiming.end) > 0
      )
        throw new ImportError("incomplete");
    }
    const childLocation = locationText(child.location);
    if (childLocation && location && childLocation !== location)
      throw new ImportError("unsupported");
    location ||= childLocation;
    // Remaining capacity, offers/inventory and participant counts are never substitutes.
    if (
      !Number.isSafeInteger(child.maximumAttendeeCapacity) ||
      (child.maximumAttendeeCapacity as number) < 1
    )
      throw new ImportError("incomplete");
    return {
      name: publicEventText(child.name),
      date: times.start.date,
      startTime: times.start.time,
      endTime: times.end.time,
      capacity: child.maximumAttendeeCapacity as number,
      sourceTiming: {
        start: child.startDate as string,
        end: child.endDate as string,
      },
    };
  });
  const parsed = importPreviewSchema.safeParse({
    sourceUrl,
    title,
    description,
    location,
    timezone: null,
    slots,
  });
  if (!parsed.success) throw new ImportError("incomplete");
  return parsed.data;
}
