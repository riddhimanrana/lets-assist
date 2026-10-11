import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
}));
mock.module("@/app/organization/actions", () => ({
  joinOrganization: async () => {
    throw new Error("Rendering must not join an organization");
  },
}));
mock.module("@/app/organization/CsvVerificationModal", () => ({
  CsvVerificationModal: () => null,
}));

const { default: OrganizationsDisplay } =
  await import("./OrganizationsDisplay");

function emptyState({
  isLoggedIn,
  isTrusted = false,
  applicationStatus,
  role,
}: {
  isLoggedIn: boolean;
  isTrusted?: boolean;
  applicationStatus?: boolean | null;
  role?: "member" | "staff" | "admin";
}) {
  const html = renderToStaticMarkup(
    <OrganizationsDisplay
      organizations={[]}
      memberCounts={{}}
      isLoggedIn={isLoggedIn}
      isTrusted={isTrusted}
      applicationStatus={applicationStatus}
      userMemberships={role ? [{ role, organizations: null }] : []}
    />,
  );
  const start = html.indexOf('data-slot="empty"');
  expect(start).toBeGreaterThanOrEqual(0);
  // The empty state is the final content group. Excluding the preceding page
  // header ensures its duplicate actions cannot satisfy these assertions.
  return html.slice(start);
}

describe("organization directory empty-state eligibility", () => {
  test("visitors receive sign-in guidance without join or create controls", () => {
    for (const isTrusted of [false, true]) {
      const html = emptyState({ isLoggedIn: false, isTrusted });
      expect(html).toContain('href="/login?redirect=/organization"');
      expect(html).not.toContain("Join with code");
      expect(html).not.toContain('href="/organization/create"');
    }
  });

  test("signed-in users can join while creation eligibility is unresolved or refused", () => {
    for (const applicationStatus of [undefined, null, false]) {
      const html = emptyState({ isLoggedIn: true, applicationStatus });
      expect(html).toContain("Join with code");
      expect(html).not.toContain('href="/organization/create"');
      expect(html).not.toContain('href="/login?redirect=/organization"');
    }
  });

  test("trusted users and approved applicants get the existing create route", () => {
    for (const props of [
      { isTrusted: true },
      { isTrusted: false, applicationStatus: true },
    ]) {
      const html = emptyState({ isLoggedIn: true, ...props });
      expect(html).toContain("Join with code");
      expect(html).toContain('href="/organization/create"');
    }
  });

  test("an organization role alone does not grant global creation eligibility", () => {
    for (const role of ["member", "staff", "admin"] as const) {
      const html = emptyState({ isLoggedIn: true, role });
      expect(html).toContain("Join with code");
      expect(html).not.toContain('href="/organization/create"');
    }
  });
});
