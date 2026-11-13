import { expect, test } from "bun:test";
import {
  buildCertificatePrintHtml,
  type PrintCertificateData,
} from "./PrintCertificate";
const data: PrintCertificateData = {
  id: "fictional-id",
  project_title: "Park <cleanup>",
  creator_name: "Sam",
  is_certified: false,
  event_start: "2026-11-09T18:00:00Z",
  issued_at: "2026-11-10T18:00:00Z",
  organization_name: null,
  volunteer_name: "Alex",
  project_location: "Park",
  durationText: "8 hours",
};
test("self-reported print never claims organizer verification", () => {
  const html = buildCertificatePrintHtml({
    ...data,
    isSelfReported: true,
    is_certified: true,
  });
  expect(html).toContain("Self-reported hours");
  expect(html).toContain("Not verified by an organizer.");
  expect(html).not.toContain("OFFICIALLY VERIFIED");
  expect(html).not.toContain("This certifies that");
  expect(html).toContain("Park &lt;cleanup&gt;");
});
test("print fits a landscape content area rather than viewport dimensions", () => {
  const html = buildCertificatePrintHtml(data);
  expect(html).toContain("letter landscape");
  expect(html).not.toContain("100vh");
  expect(html).toContain("margin: 0.5in");
  expect(html).toContain("lets-assist.com/certificates/fictional-id");
});
