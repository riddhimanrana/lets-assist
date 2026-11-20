import { expect, test } from "bun:test";
import { parsePublicSignUpGenius } from "./signupgenius-parser";
import {
  JSONLD_MAX_SCRIPTS,
  JSONLD_MAX_SCRIPT_BYTES,
  JSONLD_MAX_TOTAL_BYTES,
  JSONLD_MAX_DEPTH,
  JSONLD_MAX_NODES,
} from "./signupgenius-jsonld-source";

const source = "https://www.signupgenius.com/go/10C0B4CAEAD2EA6FEC34";
const event = {
  "@context": "https://schema.org",
  "@type": "Event",
  name: "Fictional park cleanup",
  description: "Bring <b>gloves</b> &amp; water.",
  location: {
    "@type": "Place",
    name: "Fictional park",
    address: {
      "@type": "PostalAddress",
      streetAddress: "100 Fictional Lane",
      addressLocality: "Example City",
    },
  },
  startDate: "2025-10-12T09:00:00-07:00",
  endDate: "2025-10-12T11:00:00-07:00",
  maximumAttendeeCapacity: 6,
};
const script = (value: unknown) =>
  `<script type="application/ld+json">${JSON.stringify(value).replaceAll("<", "\\u003c")}</script>`;
const parse = (value: unknown) =>
  parsePublicSignUpGenius(
    `<html><head>${script(value)}</head><body>Fictional table with no extraction semantics.</body></html>`,
    source,
  );
const rejects = (value: unknown, code = "incomplete") =>
  expect(() => parse(value)).toThrow(code);

test("projects explicit standards data, preserving historic timing, total capacity and offset uncertainty", () => {
  const preview = parse({ ...event, remainingAttendeeCapacity: 1 });
  expect(preview.title).toBe(event.name);
  expect(preview.description).toBe("Bring gloves & water.");
  expect(preview.location).toBe(
    "Fictional park, 100 Fictional Lane, Example City",
  );
  expect(preview.timezone).toBeNull();
  expect(preview.slots).toEqual([
    {
      name: event.name,
      date: "2025-10-12",
      startTime: "09:00",
      endTime: "11:00",
      capacity: 6,
      sourceTiming: { start: event.startDate, end: event.endDate },
    },
  ]);
});
test("inline sub-events become slots without counting the parent capacity again", () => {
  const preview = parse({
    ...event,
    maximumAttendeeCapacity: 99,
    endDate: "2025-10-13T12:00:00-07:00",
    subEvent: [
      { ...event, name: "Setup crew" },
      {
        ...event,
        name: "Cleanup crew",
        startDate: "2025-10-13T10:00:00-07:00",
        endDate: "2025-10-13T11:00:00-07:00",
        maximumAttendeeCapacity: 3,
      },
    ],
  });
  expect(preview.slots.map((s) => [s.name, s.date, s.capacity])).toEqual([
    ["Setup crew", "2025-10-12", 6],
    ["Cleanup crew", "2025-10-13", 3],
  ]);
});
test("supports one event in a canonical-context graph and ignores person/contact/reference payloads", () => {
  const preview = parse({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Person",
        name: "Synthetic Private Person",
        email: "private@example.test",
        "@id": "https://untrusted.test/person",
      },
      {
        ...event,
        attendee: [
          {
            "@type": "Person",
            name: "Synthetic Attendee",
            email: "attendee@example.test",
            telephone: "+1 (555) 123-4567",
            comment: "Synthetic private comment",
          },
        ],
        organizer: { name: "Synthetic Organizer" },
        "@id": "https://untrusted.test/reference",
      },
    ],
  });
  expect(JSON.stringify(preview)).not.toMatch(
    /Synthetic|example\.test|untrusted|telephone|comment|attendee/iu,
  );
});
test("removes executable markup and contact details only from selected event text", () => {
  const preview = parse({
    ...event,
    description:
      "<script>globalThis.sourceExecuted=true</script><p>Training 2025-10-11 09:00. Contact example&#64;example.test, +1 (555) 123-4567 or 555-0100.</p>",
  });
  expect(preview.description).toContain("Training 2025-10-11 09:00");
  expect(preview.description).not.toMatch(/globalThis|example\.test|555/iu);
  expect(Reflect.get(globalThis, "sourceExecuted")).toBeUndefined();
});
for (const patch of [
  { startDate: undefined },
  { endDate: undefined },
  { startDate: "2025-10-12" },
  { startDate: "2025-02-30T09:00:00Z" },
  { endDate: "2025-10-12T08:00:00-07:00" },
  { endDate: "2025-10-13T11:00:00-07:00" },
  { startDate: "2025-10-12T09:00:30-07:00" },
  { startDate: "2025-10-12T09:00:00+14:30" },
  { endDate: "2025-10-12T11:00:00+07:00" },
  { endDate: "2025-10-12T11:00:00" },
  { maximumAttendeeCapacity: undefined, remainingAttendeeCapacity: 5 },
  { maximumAttendeeCapacity: "6" },
  { maximumAttendeeCapacity: 0 },
  { maximumAttendeeCapacity: 10001 },
  { remainingAttendeeCapacity: 7 },
])
  test(`rejects incomplete or contradictory event facts ${JSON.stringify(patch)}`, () =>
    rejects({ ...event, ...patch }));
test("does not invent timezone or future dates for explicit offsetless event times", () => {
  const preview = parse({
    ...event,
    startDate: "2025-10-12T09:00",
    endDate: "2025-10-12T11:00",
  });
  expect(preview.timezone).toBeNull();
  expect(preview.slots[0].date).toBe("2025-10-12");
  expect(preview.slots[0].sourceTiming?.start).toBe("2025-10-12T09:00");
});
for (const patch of [
  { "@context": "https://untrusted.test/context" },
  { "@context": { "@vocab": "https://schema.org/" } },
  { "@type": "Person" },
  { eventSchedule: { "@type": "Schedule", repeatFrequency: "P1W" } },
  { eventStatus: "https://schema.org/EventCancelled" },
  { previousStartDate: "2025-10-11T09:00:00Z" },
  { url: "https://untrusted.test/event" },
  { subEvent: { "@id": "https://untrusted.test/slot" } },
  { subEvents: [event] },
])
  test(`refuses unsupported semantics ${JSON.stringify(patch)}`, () =>
    rejects({ ...event, ...patch }, "unsupported"));
test("refuses multiple unrelated events, nested subevents, location conflicts and out-of-envelope timing", () => {
  rejects([event, { ...event, name: "Different event" }], "unsupported");
  rejects(
    {
      "@context": "https://schema.org",
      "@graph": [event, { ...event, name: "Different event" }],
    },
    "unsupported",
  );
  rejects({ ...event, subEvent: { ...event, subEvent: event } }, "unsupported");
  rejects(
    { ...event, subEvent: { ...event, location: "Different place" } },
    "unsupported",
  );
  rejects({
    ...event,
    subEvent: { ...event, startDate: "2025-10-12T08:00:00-07:00" },
  });
});
test("reads only JSON-LD scripts, not comments, executable scripts, remote scripts or inert templates", () => {
  for (const html of [
    `<!--${script(event)}-->`,
    `<script>${JSON.stringify(event)}</script>`,
    `<script type="application/json">${JSON.stringify(event)}</script>`,
    `<template>${script(event)}</template>`,
    `<script type="application/ld+json" src="https://untrusted.test/data">${JSON.stringify(event)}</script>`,
  ])
    expect(() => parsePublicSignUpGenius(html, source)).toThrow("unsupported");
  expect(() =>
    parsePublicSignUpGenius(
      '<script type="application/ld+json">globalThis.sourceExecuted=true</script>',
      source,
    ),
  ).toThrow("unsupported");
  expect(Reflect.get(globalThis, "sourceExecuted")).toBeUndefined();
});
test("bounds JSON-LD script size, total bytes, script count, depth and node count", () => {
  const padded = { ...event, unused: "x".repeat(JSONLD_MAX_SCRIPT_BYTES) };
  expect(() => parse(padded)).toThrow("too_large");
  expect(() =>
    parsePublicSignUpGenius(
      script(event).repeat(JSONLD_MAX_SCRIPTS + 1),
      source,
    ),
  ).toThrow("too_large");
  const medium = script({
    ...event,
    unused: "x".repeat(Math.floor(JSONLD_MAX_TOTAL_BYTES / 3)),
  });
  expect(() => parsePublicSignUpGenius(medium.repeat(4), source)).toThrow(
    "too_large",
  );
  let deep: unknown = {};
  for (let i = 0; i < JSONLD_MAX_DEPTH + 1; i++) deep = { child: deep };
  expect(() => parse({ ...event, unused: deep })).toThrow("too_large");
  expect(() =>
    parse({ ...event, unused: Array(JSONLD_MAX_NODES + 1).fill(0) }),
  ).toThrow("too_large");
});
