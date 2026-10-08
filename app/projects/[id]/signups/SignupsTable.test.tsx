import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SignupsTable } from "./SignupsTable";
import type { OrganizerSignup } from "./signups-format";

test("organizers can render attended and cancelled sign-ups together", () => {
  const signups: OrganizerSignup[] = ["attended", "cancelled"].map(
    (status, index) => ({
      id: `fictional-signup-${index}`,
      created_at: "2040-01-01T00:00:00Z",
      status: status as OrganizerSignup["status"],
      user_id: null,
      anonymous_id: `fictional-volunteer-${index}`,
      schedule_id: "oneTime",
      anonymous_signup: {
        id: `fictional-volunteer-${index}`,
        name: `Fictional volunteer ${index}`,
        email: `volunteer-${index}@local.test`,
      },
    }),
  );
  const html = renderToStaticMarkup(
    <SignupsTable
      signups={signups}
      showComments={false}
      showWaiver={false}
      statusSort="asc"
      onToggleStatusSort={() => {}}
      processing={{}}
      unrejecting={{}}
      waiverDownloads={{}}
      onReject={() => {}}
      onUnreject={() => {}}
      onViewResponses={() => {}}
      onViewWaiver={() => {}}
      onDownloadWaiver={() => {}}
    />,
  );
  expect(html).toContain("Attended");
  expect(html).toContain("Cancelled");
  expect(html).toContain("Fictional volunteer 0");
  expect(html).toContain("Fictional volunteer 1");
});
