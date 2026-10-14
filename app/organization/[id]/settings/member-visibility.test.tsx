import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { OrganizationWithSettings } from "./organization-form-schema";
mock.module("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
mock.module("./actions", () => ({
  updateOrganization: async () => {
    throw Error("No privacy write is allowed in this semantic test");
  },
  checkUsernameAvailability: async () => {
    throw Error("No username query expected");
  },
}));
const { default: EditOrganizationForm } =
  await import("./EditOrganizationForm");
const organization = {
  id: "00000000-0000-4000-8000-000000000071",
  name: "Fictional organization",
  username: "fictional-organization",
  description: "Fictional form fixture",
  type: "nonprofit",
  show_members_publicly: false,
} as OrganizationWithSettings;
test("the actual member-visibility switch has a name and associated explanation", () => {
  const html = renderToStaticMarkup(
    <EditOrganizationForm
      organization={organization}
      userId="fictional-owner"
      section="members"
    />,
  );
  expect(html).toContain('aria-label="Show members publicly"');
  expect(html).toContain(
    'aria-describedby="show-members-publicly-description"',
  );
  expect(html).toContain('id="show-members-publicly-description"');
  expect(html).toContain('for="showMembersPublicly"');
  expect(html).toContain(
    "Allow visitors to see the list of organization members",
  );
  expect(html).toContain('aria-checked="false"');
});
