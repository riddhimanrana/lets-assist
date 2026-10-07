import { expect, test } from "bun:test";
import JSZip from "jszip";
import {
  ACCOUNT_EXPORT_DATASET_NAMES,
  createUserDataExport,
  createUserDataExportArchive,
} from "./user-data-export";
const userId = "fa900000-0000-4000-8000-000000000001";
function snapshot() {
  const datasets: Record<string, Record<string, unknown>[]> =
    Object.fromEntries(ACCOUNT_EXPORT_DATASET_NAMES.map((key) => [key, []]));
  return {
    schemaVersion: "2026-10-07",
    generatedAt: "2026-10-07T00:00:00Z",
    userId,
    auth: {
      id: userId,
      email: "synthetic@example.test",
      phone: null,
      createdAt: "2026-10-07T00:00:00Z",
      lastSignInAt: null,
      emailConfirmedAt: null,
      phoneConfirmedAt: null,
      identities: [],
    },
    datasets,
    counts: Object.fromEntries(
      ACCOUNT_EXPORT_DATASET_NAMES.map((key) => [key, 0]),
    ),
    totalRecords: 0,
  };
}
test("archive preserves more than a Data API page and includes verified plugin records", async () => {
  const value = snapshot();
  value.datasets.notifications = Array.from({ length: 1205 }, (_, id) => ({
    id,
    title: `Synthetic ${id}`,
  }));
  value.datasets.csfApplications = [
    { id: "synthetic-csf", status: "accepted" },
  ];
  value.datasets.dvMemberships = [{ id: "synthetic-dv", status: "approved" }];
  for (const [key, rows] of Object.entries(value.datasets))
    value.counts[key] = rows.length;
  value.totalRecords = 1207;
  const archive = await createUserDataExportArchive(userId, undefined, {
    readSnapshot: async () => value,
  });
  const zip = await JSZip.loadAsync(archive.zipBuffer);
  expect(
    JSON.parse(
      await zip.file("notifications/notifications.json")!.async("string"),
    ),
  ).toHaveLength(1205);
  expect(
    await zip.file("csf-records/csfApplications.json")!.async("string"),
  ).toContain("synthetic-csf");
  expect(
    await zip.file("dv-records/dvMemberships.json")!.async("string"),
  ).toContain("synthetic-dv");
  expect(archive.manifest.totalRecords).toBe(1207);
  expect(archive.manifest.scope.excluded.join(" ")).toContain(
    "Binary attachments",
  );
  const second = await createUserDataExportArchive(userId, undefined, {
    readSnapshot: async () => value,
  });
  expect(second.zipBuffer.equals(archive.zipBuffer)).toBe(true);
});
test("query failure produces no partial archive", async () => {
  await expect(
    createUserDataExportArchive(userId, undefined, {
      readSnapshot: async () => {
        throw new Error("synthetic database failure");
      },
    }),
  ).rejects.toThrow();
});
for (const mutate of [
  (s: ReturnType<typeof snapshot>) => {
    s.userId = "fa900000-0000-4000-8000-000000000002";
  },
  (s: ReturnType<typeof snapshot>) => {
    s.auth.id = "fa900000-0000-4000-8000-000000000002";
  },
  (s: ReturnType<typeof snapshot>) => {
    delete s.datasets.csfApplications;
  },
  (s: ReturnType<typeof snapshot>) => {
    s.counts.notifications = 1;
  },
  (s: ReturnType<typeof snapshot>) => {
    s.totalRecords = 1;
  },
  (s: ReturnType<typeof snapshot>) => {
    s.datasets.unknownPrivateTable = [];
  },
])
  test("refuses inconsistent snapshot identity, scope, or counts", async () => {
    const value = snapshot();
    mutate(value);
    await expect(
      createUserDataExport(userId, undefined, {
        readSnapshot: async () => value,
      }),
    ).rejects.toThrow();
  });
test("cannot opt out of redaction and structured answers never export credential keys", async () => {
  const value = snapshot();
  value.datasets.projectDrafts = [
    {
      draft_data: {
        title: "Synthetic",
        join_code: "private-code",
        nested: { signed_url: "private-url", apiKey: "private-key" },
      },
    },
  ];
  value.counts.projectDrafts = 1;
  value.totalRecords = 1;
  const result = await createUserDataExport(userId, undefined, {
    readSnapshot: async () => value,
  });
  expect(result.json).not.toContain("private-code");
  expect(result.json).not.toContain("private-url");
  expect(result.json).not.toContain("private-key");
  await expect(
    createUserDataExport(
      userId,
      { sanitizeSensitive: false },
      { readSnapshot: async () => value },
    ),
  ).rejects.toThrow("Unsanitized");
});
test("fails instead of truncating a dataset beyond the declared bound", async () => {
  const value = snapshot();
  value.datasets.notifications = Array.from({ length: 10001 }, () => ({}));
  value.counts.notifications = 10001;
  value.totalRecords = 10001;
  await expect(
    createUserDataExport(userId, undefined, {
      readSnapshot: async () => value,
    }),
  ).rejects.toThrow();
});
