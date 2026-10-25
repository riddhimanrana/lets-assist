import { describe, expect, test } from "bun:test";
import {
  exportJobPresentation,
  exportJobSchema,
  exportRequestMessage,
  mergeExportJob,
  validExportDownloadUrl,
  type ExportJob,
} from "./data-export-state";

const now = Date.parse("2026-10-07T12:00:00Z");
const ready: ExportJob = {
  id: "10000000-0000-4000-8000-000000000001",
  status: "completed",
  delivery_email: "fictional@example.test",
  requested_at: "2026-10-07T10:00:00Z",
  completed_at: "2026-10-07T10:10:00Z",
  artifact_expires_at: "2026-10-08T10:10:00Z",
  zip_size_bytes: 1024,
  record_count: 4,
  delivery_status: "not_attempted",
  protocol_version: 2,
  error_message: null,
};

describe("export job presentation", () => {
  test("completed means archive ready while email remains a separate state", () => {
    expect(exportJobPresentation(ready, now)).toMatchObject({
      label: "Ready",
      canDownload: true,
      active: false,
      emailLabel: "Email not attempted",
      shouldPoll: true,
    });
  });

  test.each([
    ["accepted", "Email accepted for delivery"],
    ["sending", "Email unconfirmed"],
    ["failed", "Email failed"],
    ["skipped", "Email skipped"],
  ] as const)(
    "email %s does not hide a ready archive",
    (delivery_status, label) => {
      const result = exportJobPresentation({ ...ready, delivery_status }, now);
      expect(result.canDownload).toBe(true);
      expect(result.label).toBe("Ready");
      expect(result.emailLabel).toBe(label);
      expect(result.shouldPoll).toBe(false);
      if (delivery_status !== "accepted")
        expect(result.emailWarning).toBeTruthy();
    },
  );

  test("expired at the exact deadline cannot download or poll", () => {
    const result = exportJobPresentation(
      ready,
      Date.parse(ready.artifact_expires_at!),
    );
    expect(result).toMatchObject({
      label: "Expired",
      canDownload: false,
      shouldPoll: false,
    });
    expect(result.description).toContain("Request another export");
  });

  test.each([null, "not-a-date"])(
    "missing or invalid expiry fails closed: %s",
    (artifact_expires_at) => {
      expect(
        exportJobPresentation({ ...ready, artifact_expires_at }, now),
      ).toMatchObject({
        label: "Download unavailable",
        canDownload: false,
        shouldPoll: false,
      });
    },
  );

  test.each(["pending", "processing"] as const)(
    "%s is active and polls without offering download",
    (status) => {
      expect(exportJobPresentation({ ...ready, status }, now)).toMatchObject({
        active: true,
        canDownload: false,
        shouldPoll: true,
      });
    },
  );

  test("failed archive exposes the safe server error without claiming delivery", () => {
    const result = exportJobPresentation(
      { ...ready, status: "failed", error_message: "The export needs review." },
      now,
    );
    expect(result).toMatchObject({
      label: "Failed",
      description: "The export needs review.",
      canDownload: false,
      shouldPoll: false,
    });
  });

  test.each([
    { ...ready, protocol_version: 1 },
    { ...ready, protocol_version: 3 },
    { ...ready, status: "legacy" as const },
  ])(
    "legacy requests need review even with completed-looking timestamps",
    (job) => {
      expect(exportJobPresentation(job, now)).toMatchObject({
        label: "Needs review",
        emailLabel: "Email status unknown",
        active: false,
        canDownload: false,
        shouldPoll: false,
      });
    },
  );

  test("server readback replaces an existing job without inventing pending state or an ID", () => {
    const pending = { ...ready, status: "pending" as const };
    expect(mergeExportJob([pending], ready)).toEqual([ready]);
    expect(exportRequestMessage(true)).toContain("existing export request");
    expect(exportRequestMessage(true)).toContain("one every 24 hours");
    expect(exportRequestMessage(false)).toContain("has been recorded");
  });

  test("history retains only the five newest actual jobs", () => {
    const jobs = Array.from({ length: 6 }, (_, index) => ({
      ...ready,
      id: `10000000-0000-4000-8000-00000000000${index + 1}`,
      requested_at: `2026-10-0${index + 1}T10:00:00Z`,
    }));
    expect(
      mergeExportJob(jobs.slice(0, 5), jobs[5]).map((job) => job.id),
    ).toEqual(
      jobs
        .slice(1)
        .reverse()
        .map((job) => job.id),
    );
  });

  test("readback parser rejects incomplete and unknown job states", () => {
    expect(exportJobSchema.safeParse(ready).success).toBe(true);
    expect(
      exportJobSchema.safeParse({ ...ready, status: "sent" }).success,
    ).toBe(false);
    expect(
      exportJobSchema.safeParse({ ...ready, delivery_status: undefined })
        .success,
    ).toBe(false);
    expect(
      exportJobSchema.safeParse({ ...ready, record_count: -1 }).success,
    ).toBe(false);
  });

  test("download URL accepts HTTPS and local HTTP while rejecting unsafe navigation", () => {
    expect(
      validExportDownloadUrl(
        "https://files.example.test/archive?token=fictional",
      ),
    ).toBe(true);
    expect(validExportDownloadUrl("http://127.0.0.1:54321/archive")).toBe(true);
    for (const value of [
      "javascript:alert(1)",
      "data:text/html,test",
      "/relative",
      "http://files.example.test/archive",
    ])
      expect(validExportDownloadUrl(value)).toBe(false);
  });
});
