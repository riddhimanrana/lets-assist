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
  expect(html).not.toContain(">Reject<");
  expect(html).not.toContain(">Unreject<");
});

const fixtureSignup: OrganizerSignup = {
  id: "fictional-waiver-signup",
  created_at: "2040-01-01T00:00:00Z",
  status: "approved",
  user_id: null,
  anonymous_id: "fictional-waiver-volunteer",
  schedule_id: "oneTime",
  anonymous_signup: {
    id: "fictional-waiver-volunteer",
    name: "Fictional volunteer",
    email: "fictional@local.test",
  },
};
const signedFixture = {
  id: "fictional-existing-signature",
  created_at: "2040-01-01T00:00:00Z",
  signature_type: "typed",
  signer_name: "Fictional volunteer",
  signed_at: "2040-01-01T00:00:00Z",
  signature_text: "Synthetic test metadata",
  signature_storage_path: null,
  upload_storage_path: null,
  signature_payload: null,
};
function waiverMarkup(signup: OrganizerSignup, showWaiver: boolean) {
  return renderToStaticMarkup(
    <SignupsTable
      signups={[signup]}
      showComments={false}
      showWaiver={showWaiver}
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
}

test("an unsigned signup with an empty signature join is never labelled signed", () => {
  const html = waiverMarkup({ ...fixtureSignup, waiver_signature: [] }, true);
  expect(html).toContain("Missing");
  expect(html).not.toContain(">Signed<");
});

test("waiver-disabled projects hide stale signature metadata, while a stored signed row is labelled signed", () => {
  const signup = { ...fixtureSignup, waiver_signature: signedFixture };
  expect(waiverMarkup(signup, false)).not.toContain(">Signed<");
  const enabled = waiverMarkup(signup, true);
  expect(enabled).toContain(">Signed<");
  expect(enabled).not.toContain(">Missing<");
});
