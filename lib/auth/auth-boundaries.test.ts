import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readProjectActionSource } from "@/tests/support/project-action-source";
import { readAdminActionSource } from "@/tests/support/admin-action-source";

const ROOT = process.cwd();
const SENSITIVE_MFA_GUARD =
  /getAuthUser\(\{\s*sensitive:\s*true,\s*checkMfa:\s*true,?\s*\}\)/u;

function read(relativePath: string) {
  return readFileSync(`${ROOT}/${relativePath}`, "utf8");
}

test("signup does not enumerate Supabase Auth users", () => {
  const source = read("app/signup/actions.ts");
  assert.doesNotMatch(source, /auth\.admin\.listUsers/u);
  assert.doesNotMatch(source, /export async function checkEmailStatus/u);
  assert.match(source, /user\.identities\.length === 0/u);
});

test("signup delegates profile creation to the auth metadata trigger", () => {
  const source = read("app/signup/actions.ts");

  assert.match(source, /metadata supplied to auth\.signUp/u);
  assert.match(source, /public\.handle_new_user\(\)/u);
  assert.match(source, /full_name: validatedFields\.data\.fullName/u);
  assert.match(source, /phone: validatedFields\.data\.phone/u);
  assert.doesNotMatch(source, /\.from\("profiles"\)/u);
  assert.doesNotMatch(source, /Profile upsert after signup failed/u);
});

test("the OAuth-only password setter rejects an existing email identity", () => {
  const source = read("app/account/security/actions.ts");
  assert.match(source, /identity\.provider === "email"/u);
  assert.match(source, /Use the current-password form/u);
});

test("confirmation never reports success without a verification credential", () => {
  const source = read("app/auth/confirm/route.ts");
  assert.match(source, /Missing%20verification%20credential/u);
  assert.doesNotMatch(source, /assuming success/u);
});

test("the shared super-admin guard uses fresh auth and MFA assurance", () => {
  const source = readAdminActionSource();
  assert.match(source, /getAuthUser\(\{ sensitive: true, checkMfa: true \}\)/u);
});

test("signup defers organization membership until verified login", () => {
  const signupSource = read("app/signup/actions.ts");
  const affiliationSource = read(
    "lib/organization/verified-domain-affiliation.ts",
  );
  const loginSource = read("app/login/actions.ts");

  assert.doesNotMatch(signupSource, /applyStaffInviteForUser/u);
  assert.doesNotMatch(signupSource, /from\("organization_members"\)/u);
  assert.match(signupSource, /pending_staff_token/u);
  assert.match(affiliationSource, /user\.email_confirmed_at/u);
  assert.match(affiliationSource, /apply_verified_domain_affiliation/u);
  assert.match(affiliationSource, /status: "suppressed"/u);
  assert.doesNotMatch(
    affiliationSource,
    /\.from\("organization_members"\)\s*\n\s*\.insert/u,
  );
  assert.match(loginSource, /applyVerifiedDomainAffiliation/u);
});

test("explicit organization removal records an auto-join suppression atomically", () => {
  const source = read("app/organization/[id]/actions.ts");
  const selfLeaveSource = read("app/organization/actions.ts");
  const removeStart = source.indexOf("export async function removeMember");
  const removeFlow = source.slice(removeStart);

  assert.match(
    removeFlow,
    /remove_organization_member_with_autojoin_suppression/u,
  );
  assert.doesNotMatch(
    removeFlow,
    /from\("organization_members"\)\s*\n\s*\.delete\(\)/u,
  );
  assert.match(
    selfLeaveSource,
    /remove_organization_member_with_autojoin_suppression/u,
  );
  assert.doesNotMatch(
    selfLeaveSource,
    /from\("organization_members"\)\s*\n\s*\.delete\(\)/u,
  );
});

test("account-security mutations require fresh auth and completed MFA", () => {
  const securityActions = read("app/account/security/actions.ts");
  const emailActions = read("app/account/email-actions.ts");
  const mfaPaths = read("lib/auth/mfa-paths.ts");

  for (const functionName of [
    "updatePasswordAction",
    "setPasswordAction",
    "updateEmailAction",
    "deleteAccount",
  ]) {
    const start = securityActions.indexOf(
      `export async function ${functionName}`,
    );
    const end = securityActions.indexOf("export async function", start + 30);
    const action = securityActions.slice(start, end === -1 ? undefined : end);
    assert.match(action, SENSITIVE_MFA_GUARD);
  }

  const primaryStart = emailActions.indexOf(
    "export async function setPrimaryEmailAction",
  );
  const primaryEnd = emailActions.indexOf(
    "export async function",
    primaryStart + 30,
  );
  assert.match(
    emailActions.slice(primaryStart, primaryEnd),
    SENSITIVE_MFA_GUARD,
  );
  assert.match(mfaPaths, /"\/account\/security"/u);
});

test("project updates cannot reassign ownership or organization identity", () => {
  const source = readProjectActionSource(ROOT);
  const start = source.indexOf("export async function updateProject(");
  const end = source.indexOf("export async function checkInParticipant", start);
  const action = source.slice(start, end);

  assert.match(action, /"creator_id"/u);
  assert.match(action, /"organization_id"/u);
  assert.match(
    action,
    /delete (?:mutableSanitizedUpdates|sanitizedUpdates)\[field\]/u,
  );
});
