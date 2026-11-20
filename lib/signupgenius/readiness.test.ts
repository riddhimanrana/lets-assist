import { expect, test } from "bun:test";
import { getImportReadinessIssues } from "./readiness";
import {
  importPreviewSchema,
  importPreviewToDraft,
  type ImportPreview,
} from "./model";
import { storeImportPreview } from "./handoff";
import { projectCreationLoginUrl } from "@/lib/projects/creation-session";

const preview: ImportPreview = {
  sourceUrl: "https://www.signupgenius.com/go/10C0B4CAEAD2EA6FEC34",
  title: "Fictional cleanup",
  description: "Bring gloves.",
  location: "Fictional park",
  timezone: "America/Los_Angeles",
  slots: [
    {
      name: "Setup crew",
      date: "2099-10-12",
      startTime: "09:00",
      endTime: "11:00",
      capacity: 6,
    },
  ],
};
const now = new Date("2026-11-18T12:00:00Z");
test("allows destination-compatible values at the exact limits", () => {
  const p = {
    ...preview,
    title: "T".repeat(125),
    description: "D".repeat(2000),
    location: "L".repeat(250),
    slots: [{ ...preview.slots[0], name: "S".repeat(75), capacity: 1000 }],
  };
  expect(getImportReadinessIssues(p, now)).toEqual({});
});
for (const [field, max] of [
  ["title", 125],
  ["description", 2000],
  ["location", 250],
] as const)
  test(`preserves ${field} beyond destination limit and requires correction`, () => {
    const p = { ...preview, [field]: "x".repeat(max + 1) };
    expect(importPreviewSchema.parse(p)[field]).toHaveLength(max + 1);
    expect(getImportReadinessIssues(p, now)[field]).toContain(String(max));
  });
test("identifies slot name/capacity errors at their original indices across grouped dates", () => {
  const p = {
    ...preview,
    slots: [
      { ...preview.slots[0], date: "2099-10-13" },
      { ...preview.slots[0], name: "S".repeat(76), capacity: 1001 },
    ],
  };
  expect(getImportReadinessIssues(p, now)).toMatchObject({
    "slots.1.name": expect.stringContaining("75"),
    "slots.1.capacity": expect.stringContaining("1000"),
  });
  expect(importPreviewSchema.parse(p).slots[1].capacity).toBe(1001);
});
test("requires missing destination fields and historical-date correction without moving dates", () => {
  const p = {
    ...preview,
    description: "",
    location: "",
    slots: [{ ...preview.slots[0], date: "2025-10-12" }],
  };
  expect(getImportReadinessIssues(p, now)).toMatchObject({
    description: expect.any(String),
    location: expect.any(String),
    "slots.0.date": expect.stringContaining("past"),
  });
  expect(importPreviewToDraft(p).schedule?.multiDay[0].date).toBe("2025-10-12");
});
test("preserves known offsets and refuses conflicting timezone choices until timing is explicitly edited", () => {
  const p = {
    ...preview,
    slots: [
      {
        ...preview.slots[0],
        sourceTiming: {
          start: "2099-10-12T09:00:00-07:00",
          end: "2099-10-12T11:00:00-07:00",
        },
      },
    ],
  };
  expect(getImportReadinessIssues(p, now)).toEqual({});
  expect(
    getImportReadinessIssues({ ...p, timezone: "UTC" }, now).timezone,
  ).toContain("source offset");
  expect(
    getImportReadinessIssues({ ...p, timezone: null }, now).timezone,
  ).toContain("Choose");
  expect(
    getImportReadinessIssues(
      { ...p, timezone: "UTC", slots: [{ ...p.slots[0], date: "2099-10-13" }] },
      now,
    ),
  ).toEqual({});
});
test("retains explicit organization context in handoff and authentication redirects without importing authority", () => {
  const id = "11111111-1111-4111-8111-111111111111",
    org = "22222222-2222-4222-8222-222222222222";
  const storage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  const target = storeImportPreview(storage, id, preview, 1000, org);
  expect(new URL(target, "https://example.test").searchParams.get("org")).toBe(
    org,
  );
  const login = new URL(
    projectCreationLoginUrl({
      org,
      import: id,
      creation: id,
      draft: "owned-draft",
    }),
    "https://example.test",
  );
  const resumed = new URL(
    login.searchParams.get("redirect")!,
    "https://example.test",
  );
  expect(resumed.searchParams.get("org")).toBe(org);
  expect(resumed.searchParams.get("draft")).toBe("owned-draft");
  expect(resumed.searchParams.get("import")).toBe(id);
  expect(importPreviewToDraft(preview, org).basicInfo?.organizationId).toBe(
    org,
  );
  expect(importPreviewToDraft(preview).basicInfo?.organizationId).toBeNull();
  expect(
    projectCreationLoginUrl({ org: "https://untrusted.test", import: "bad" }),
  ).toBe("/login?redirect=/projects/create");
});
