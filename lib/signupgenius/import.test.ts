import { describe, expect, test } from "bun:test";
import { canonicalSignUpGeniusUrl } from "./url";
import {
  importPreviewSchema,
  importPreviewToDraft,
  isHistoricalImport,
  type ImportPreview,
} from "./model";
import {
  readImportPreview,
  storeImportPreview,
  IMPORT_STORAGE_PREFIX,
} from "./handoff";

const id = "10C0B4CAEAD2EA6FEC34-67010857-science";
const canonical = `https://www.signupgenius.com/go/${id}`;
export const syntheticPreview: ImportPreview = {
  sourceUrl: canonical,
  title: "Fictional park cleanup",
  description: "Bring gloves & water.\nMeet at the gate.",
  location: "Fictional Park",
  timezone: "America/Los_Angeles",
  slots: [
    {
      name: "Trail crew",
      date: "2025-10-12",
      startTime: "09:00",
      endTime: "11:00",
      capacity: 6,
    },
  ],
};

describe("public source URL boundary", () => {
  for (const input of [
    canonical,
    `http://signupgenius.com/go/${id}`,
    `https://www.signupgenius.com/go/${id}/?tracking=discard`,
    `https://m.signupgenius.com/#!/showSignUp/${id}`,
  ]) {
    test(`canonicalizes ${input}`, () =>
      expect(canonicalSignUpGeniusUrl(input)).toBe(canonical));
  }
  for (const input of [
    "https://signupgenius.com.evil.test/go/" + id,
    "https://evil.test/go/" + id,
    "https://user@www.signupgenius.com/go/" + id,
    "https://www.signupgenius.com:443/go/" + id,
    "http://www.signupgenius.com:80/go/" + id,
    "https://www.signupgenius.com:8443/go/" + id,
    "https://127.0.0.1/go/" + id,
    "https://[::1]/go/" + id,
    "https://signupgenius.com./go/" + id,
    "https://www.signupgenius.com/admin",
    "https://www.signupgenius.com/go/%2e%2e/admin",
    "https://www.signupgenius.com/go/" + id + "/extra",
    "https://www.signupgenius.com/go/" + id + "#private",
    "https://m.signupgenius.com/#!/showSignUp/" + id + "/extra",
    "ftp://www.signupgenius.com/go/" + id,
    "https://www.signupgenius.com\\@evil.test/go/" + id,
    "",
    "not a url",
    "https://www.signupgenius.com/go/short",
  ])
    test(`rejects ${input}`, () =>
      expect(() => canonicalSignUpGeniusUrl(input)).toThrow());
});

describe("typed preview and editor handoff", () => {
  test("preserves historical dates, exact capacities and plain text", () => {
    const draft = importPreviewToDraft(syntheticPreview);
    expect(draft.schedule?.multiDay[0]).toEqual({
      date: "2025-10-12",
      slots: [
        {
          name: "Trail crew",
          startTime: "09:00",
          endTime: "11:00",
          volunteers: 6,
        },
      ],
    });
    expect(draft.visibility).toBe("unlisted");
    expect(draft.showAttendeesPublicly).toBe(false);
    expect(draft.basicInfo?.description).toBe(
      "<p>Bring gloves &amp; water.<br>Meet at the gate.</p>",
    );
    expect(
      isHistoricalImport(syntheticPreview, new Date("2026-11-18T12:00:00Z")),
    ).toBe(true);
  });
  test("never accepts participant fields or arbitrary draft settings", () => {
    for (const extra of [
      { attendees: ["Synthetic Attendee"] },
      { signups: [] },
      { visibility: "public" },
      { phone: "555-0100" },
    ])
      expect(
        importPreviewSchema.safeParse({ ...syntheticPreview, ...extra })
          .success,
      ).toBe(false);
    expect(
      importPreviewSchema.safeParse({
        ...syntheticPreview,
        slots: [
          { ...syntheticPreview.slots[0], email: "synthetic@example.test" },
        ],
      }).success,
    ).toBe(false);
  });
  test("requires explicit valid dates, times and positive capacity", () => {
    for (const patch of [
      { date: "" },
      { date: "2025-02-30" },
      { startTime: "" },
      { endTime: "08:00" },
      { capacity: 0 },
      { capacity: NaN },
      { capacity: 10001 },
    ])
      expect(
        importPreviewSchema.safeParse({
          ...syntheticPreview,
          slots: [{ ...syntheticPreview.slots[0], ...patch }],
        }).success,
      ).toBe(false);
    expect(
      importPreviewSchema.safeParse({ ...syntheticPreview, slots: [] }).success,
    ).toBe(false);
    expect(() =>
      importPreviewToDraft({ ...syntheticPreview, timezone: null }),
    ).toThrow();
    expect(() =>
      importPreviewToDraft({
        ...syntheticPreview,
        description: "<img src=x onerror=alert(1)>",
      }),
    ).toThrow();
  });
  test("isolates tab handoffs and rejects expired or tampered records", () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
      removeItem: (key: string) => {
        data.delete(key);
      },
    };
    const token = "12345678-1234-4234-8234-123456789012";
    expect(storeImportPreview(storage, token, syntheticPreview, 1000)).toBe(
      `/projects/create?import=${token}&creation=${token}`,
    );
    expect(readImportPreview(storage, token, 1001)).toEqual(syntheticPreview);
    expect(
      readImportPreview(storage, "12345678-1234-4234-8234-123456789013", 1001),
    ).toBeNull();
    expect(readImportPreview(storage, token, 1000 + 86400000)).toBeNull();
    expect(data.size).toBe(0);
    data.set(
      IMPORT_STORAGE_PREFIX + token,
      '{"version":1,"expires":2000,"preview":{"attendees":[]}}',
    );
    expect(readImportPreview(storage, token, 1001)).toBeNull();
    expect(() =>
      storeImportPreview(storage, "../other", syntheticPreview, 1000),
    ).toThrow();
  });
});
