import { expect, mock, test } from "bun:test";

const source = "https://www.signupgenius.com/go/10C0B4CAEAD2EA6FEC34";
const event = {
  "@context": "https://schema.org",
  "@type": "Event",
  name: "Fictional cleanup",
  description: "Bring gloves.",
  location: "Fictional park",
  startDate: "2025-10-12T09:00:00-07:00",
  endDate: "2025-10-12T11:00:00-07:00",
  maximumAttendeeCapacity: 8,
  remainingAttendeeCapacity: 2,
  attendee: {
    "@type": "Person",
    name: "Synthetic Participant",
    email: "private@example.test",
  },
};
let html = "";
mock.module("@/lib/ai/rate-limit", () => ({
  consumeAiQuota: async () => ({
    allowed: true,
    resetAt: new Date(Date.now() + 60000).toISOString(),
  }),
}));
mock.module("@/services/signupgenius-fetch", () => ({
  fetchPublicSignUpGenius: async () => ({ html, sourceUrl: source }),
}));
const { POST } = await import("./route");
const request = () =>
  new Request("https://example.test/api/import/signupgenius", {
    method: "POST",
    headers: {
      origin: "https://example.test",
      "content-type": "application/json",
    },
    body: JSON.stringify({ url: source }),
  });

test("actual structured-data adapter reaches API preview without participant payloads or fabricated timezone", async () => {
  html = `<html><script type="application/ld+json">${JSON.stringify(event)}</script></html>`;
  const res = await POST(request());
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.preview.slots[0]).toMatchObject({
    date: "2025-10-12",
    capacity: 8,
    sourceTiming: { start: event.startDate, end: event.endDate },
  });
  expect(body.preview.timezone).toBeNull();
  expect(JSON.stringify(body)).not.toMatch(
    /Synthetic Participant|private@example|attendee|remainingAttendee/iu,
  );
});
test("missing total capacity remains a non-success API result even with remaining count", async () => {
  html = `<script type="application/ld+json">${JSON.stringify({ ...event, maximumAttendeeCapacity: undefined })}</script>`;
  const res = await POST(request());
  expect(res.status).toBe(422);
  expect(await res.json()).toMatchObject({ code: "incomplete" });
});
test("ordinary unverified signup markup has no fallback fabricated preview", async () => {
  html =
    '<div id="signupcontainer"><h1>Fictional event</h1><table><tr><td>Available Slot</td><td>Synthetic Participant</td></tr></table></div>';
  const res = await POST(request());
  expect(res.status).toBe(422);
  expect(await res.json()).toMatchObject({ code: "unsupported" });
});
