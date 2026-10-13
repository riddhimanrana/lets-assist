import { expect, test } from "bun:test";
import { certificateToDashboardExport } from "./dashboard-export";
import { formatCertificateDate, formatCertificateTime } from "./project-dates";

const projectZone = "America/New_York";
const certificate = {
  id: "fictional-certificate",
  event_start: "2026-10-13T03:45:00Z",
  event_end: "2026-10-13T04:15:00Z",
  issued_at: "2026-10-13T05:00:00Z",
  credited_minutes: 30,
  projects: { project_timezone: projectZone },
};

test("a New York certificate keeps its project dates and wall clocks for a Pacific viewer", () => {
  const row = certificateToDashboardExport(certificate, "fictional@local.test");
  expect(row.date).toBe("2026-10-12");
  expect(row.startTime).toBe("11:45 PM EDT");
  expect(row.endDate).toBe("2026-10-13");
  expect(row.endTime).toBe("12:15 AM EDT");
  expect(row.issuedDate).toBe("2026-10-13");
  expect(row.duration).toBe("0.5");
  expect(
    formatCertificateDate(certificate.event_end, projectZone, "display"),
  ).toBe("Oct 13, 2026");
  expect(
    formatCertificateDate(
      certificate.event_end,
      "America/Los_Angeles",
      "display",
    ),
  ).toBe("Oct 12, 2026");
});

test("spring forward labels the wall clock and abbreviation at each endpoint", () => {
  const row = certificateToDashboardExport(
    {
      ...certificate,
      credited_minutes: 60,
      event_start: "2026-03-08T06:30:00Z",
      event_end: "2026-03-08T07:30:00Z",
    },
    "fictional@local.test",
  );
  expect(row.date).toBe("2026-03-08");
  expect(row.endDate).toBe("2026-03-08");
  expect(row.startTime).toBe("1:30 AM EST");
  expect(row.endTime).toBe("3:30 AM EDT");
  expect(row.duration).toBe("1");
});

test("fall back distinguishes repeated project wall clocks without changing credited duration", () => {
  const row = certificateToDashboardExport(
    {
      ...certificate,
      credited_minutes: 60,
      event_start: "2026-11-01T05:30:00Z",
      event_end: "2026-11-01T06:30:00Z",
    },
    "fictional@local.test",
  );
  expect(row.date).toBe("2026-11-01");
  expect(row.endDate).toBe("2026-11-01");
  expect(row.startTime).toBe("1:30 AM EDT");
  expect(row.endTime).toBe("1:30 AM EST");
  expect(row.duration).toBe("1");
});

test("legacy timezone fallback formats both the date and time in the same zone", () => {
  for (const zone of [null, undefined, "not-a-zone"]) {
    expect(formatCertificateDate("2026-10-13T01:00:00Z", zone)).toBe(
      "2026-10-12",
    );
    expect(formatCertificateTime("2026-10-13T01:00:00Z", zone)).toBe(
      "6:00 PM PDT",
    );
  }
});

test("missing and invalid certificate instants never invent a labeled time", () => {
  for (const value of [null, undefined, "not-a-date"]) {
    expect(formatCertificateDate(value, projectZone)).toBe("Unknown Date");
    expect(formatCertificateTime(value, projectZone)).toBe("Unknown");
  }
});
