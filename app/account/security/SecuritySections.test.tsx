import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

const requestExport = mock(() =>
  Promise.reject(new Error("Do not request during render")),
);
const deleteAccount = mock(() =>
  Promise.reject(new Error("Do not delete during render")),
);
mock.module("./actions", () => ({
  emailDataExport: requestExport,
  getDataExportJobs: mock(() => Promise.resolve({ success: true, jobs: [] })),
  getDataExportDownload: mock(() =>
    Promise.reject(new Error("Do not download during render")),
  ),
  deleteAccount,
}));

const { default: DataExportSection } = await import("./DataExportSection");
const { default: AccountDeletionSection } =
  await import("./AccountDeletionSection");

describe("extracted account security sections", () => {
  test("export starts with history loading and explains the archive scope", () => {
    const markup = renderToStaticMarkup(<DataExportSection />);
    expect(markup).toContain("<h2>Export your data</h2>");
    expect(markup).toContain("Loading export history...");
    expect(markup).toContain("file contents are not included");
    expect(markup).toContain("linked to your account");
    expect(markup).toContain(
      "Archive readiness and email notification status are shown separately",
    );
    const requestButton = markup.match(
      /<button\b[^>]*>Request data archive<\/button>/u,
    )?.[0];
    expect(requestButton).toContain('disabled=""');
    expect(markup).toContain("Refresh status");
    expect(requestExport).not.toHaveBeenCalled();
  });

  test("account deletion retains its separate warning and dialog trigger", () => {
    const markup = renderToStaticMarkup(<AccountDeletionSection />);
    expect(markup).toContain("Remove your account and personal platform data");
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("Delete account");
    expect(deleteAccount).not.toHaveBeenCalled();
  });
});
