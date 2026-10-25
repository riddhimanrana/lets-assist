import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

const neverCalled = (name: string) => async () => {
  throw new Error(`Rendering must not call ${name}`);
};

mock.module("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
mock.module("./actions", () => ({
  completeOnboarding: neverCalled("completeOnboarding"),
  removeProfilePicture: neverCalled("removeProfilePicture"),
  updateNameAndUsername: neverCalled("updateNameAndUsername"),
  updateProfileVisibility: neverCalled("updateProfileVisibility"),
}));
mock.module("@/utils/auth/account-management", () => ({
  addEmail: neverCalled("addEmail"),
  getLinkedIdentities: neverCalled("getLinkedIdentities"),
  setPrimaryEmail: neverCalled("setPrimaryEmail"),
  unlinkEmail: neverCalled("unlinkEmail"),
  verifyEmail: neverCalled("verifyEmail"),
}));

const { ProfileForm } = await import("./ProfileForm");
const { VisibilitySection } = await import("./VisibilitySection");
const { EmailAddressesSection } = await import("./EmailAddressesSection");

const profile = {
  id: "fictional-user",
  full_name: "Sample Volunteer",
  avatar_url: null,
  username: "sample.volunteer",
  phone: "5555550100",
  profile_visibility: "private" as const,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: null,
  volunteer_goals: null,
};

test("profile form keeps its three fields and one save action tied to the form", () => {
  const html = renderToStaticMarkup(
    <ProfileForm
      profile={profile}
      isProfileLoading={false}
      isDataLoading={false}
    />,
  );

  expect(html).toContain('id="profile-form"');
  expect(html).toContain('name="fullName"');
  expect(html).toContain('name="username"');
  expect(html).toContain('name="phoneNumber"');
  expect(html).toContain('for="fullName"');
  expect(html).toContain('for="username"');
  expect(html).toContain('for="phoneNumber"');
  expect(html).toContain('aria-label="Upload profile picture"');
  expect(html).toContain("Photo changes save right away.");
  // The save button lives in the card footer, outside the form element, so it
  // must point back at the form or it would submit nothing.
  expect(html).toMatch(/<button[^>]*form="profile-form"[^>]*>Save changes/);
  expect(html.match(/type="submit"/g)).toHaveLength(1);
});

test("profile form shows placeholders, not fields, while the profile loads", () => {
  const html = renderToStaticMarkup(
    <ProfileForm profile={null} isProfileLoading isDataLoading />,
  );

  expect(html).not.toContain('name="username"');
  expect(html).toContain('data-slot="skeleton"');
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save changes/);
});

test("visibility switch is labelled and says it saves on its own", () => {
  const html = renderToStaticMarkup(
    <VisibilitySection
      profile={profile}
      isProfileLoading={false}
      isDataLoading={false}
    />,
  );

  expect(html).toContain('id="profile-visibility"');
  expect(html).toContain('aria-labelledby="profile-visibility-label"');
  expect(html).toContain("Only you and organization admins");
  expect(html).toContain("Saves automatically.");
});

test("email section points sign-in changes at the security page", () => {
  const html = renderToStaticMarkup(
    <EmailAddressesSection user={{ id: "fictional-user" }} />,
  );

  expect(html).toContain("Email addresses");
  expect(html).toContain('href="/account/security"');
  expect(html).toContain('data-slot="skeleton"');
});
