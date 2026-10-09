import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DataExportJobDetails } from "./DataExportJobDetails";
import type { ExportJob } from "./data-export-state";

const now = Date.parse("2026-10-07T12:00:00Z");
const job: ExportJob = {
  id: "10000000-0000-4000-8000-000000000001",
  status: "completed",
  delivery_email: "fictional@example.test",
  requested_at: "2026-10-07T10:00:00Z",
  completed_at: "2026-10-07T10:10:00Z",
  artifact_expires_at: "2026-10-08T10:10:00Z",
  zip_size_bytes: 0,
  record_count: 0,
  delivery_status: "sending",
  protocol_version: 2,
  error_message: null,
};
const render = (overrides: Partial<ExportJob> = {}, downloading = false) =>
  renderToStaticMarkup(
    <DataExportJobDetails
      job={{ ...job, ...overrides }}
      now={now}
      downloading={downloading}
      onDownloadAction={() => {}}
    />,
  );

describe("export history controls", () => {
  test("ready archive has a named download button and separate unconfirmed email warning", () => {
    const markup = render();
    expect(markup).toContain(">Ready</span>");
    expect(markup).toContain("Email unconfirmed");
    expect(markup).toContain("confirmation is missing");
    expect(markup).toContain('aria-label="Download export requested');
    expect(markup).toContain("Download archive");
    expect(markup).toContain("0.00 MB");
    expect(markup).toContain("0 records");
    expect(markup).not.toContain("href=");
  });

  test("a download request disables the ready button", () => {
    const markup = render({}, true);
    expect(markup).toContain('disabled=""');
    expect(markup).toContain("Preparing download...");
  });

  test.each(["pending", "processing", "failed", "legacy"] as const)(
    "%s does not render a download control",
    (status) => {
      expect(render({ status })).not.toContain("<button");
    },
  );

  test("expired archive tells the user how to recover without a stale download link", () => {
    const markup = render({ artifact_expires_at: "2026-10-07T11:00:00Z" });
    expect(markup).toContain(">Expired</span>");
    expect(markup).toContain("Request another export");
    expect(markup).not.toContain("<button");
  });

  test("legacy completed request visibly needs review", () => {
    const markup = render({ protocol_version: 1, delivery_status: "accepted" });
    expect(markup).toContain("Needs review");
    expect(markup).toContain("Email status unknown");
    expect(markup).not.toContain("<button");
  });

  test("failed notification keeps the archive accessible", () => {
    const markup = render({ delivery_status: "failed" });
    expect(markup).toContain("Email failed");
    expect(markup).toContain("A ready archive can still be downloaded here");
    expect(markup).toContain("Download archive");
  });
});
