import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const readSource = (path: string) => readFileSync(join(root, path), "utf8");

describe("DVHS CSF Google identity lifecycle wiring", () => {
  test("uses account selection only for the exact CSF import intent", () => {
    const connect = readSource("app/api/calendar/google/connect/route.ts");

    expect(connect).toContain('intent.purpose === "csf_import"');
    expect(connect).toContain('intent.pluginKey === "dvhs-csf"');
    expect(connect).toContain('["select_account"]');
    expect(connect).toContain('["consent"]');
  });

  test("validates Google-verified identity before any bound credential save", () => {
    const callback = readSource("app/api/calendar/google/callback/route.ts");
    const identityCheck = callback.indexOf(
      "validateGoogleOAuthCallbackIdentity({",
    );
    const save = callback.indexOf("saveGoogleOAuthConnectionForBinding({");

    expect(identityCheck).toBeGreaterThan(-1);
    expect(save).toBeGreaterThan(identityCheck);
    expect(callback).toContain(
      "emailVerified: userInfo.verified_email === true",
    );
    expect(callback).toContain(
      "identityEmail: isDvhsCsfGoogleImportBinding(binding)",
    );
    expect(callback).toContain(
      "identityVerifiedAt: isDvhsCsfGoogleImportBinding(binding)",
    );
  });

  test("keeps the verified CSF account email out of the return URL", () => {
    const callback = readSource("app/api/calendar/google/callback/route.ts");

    expect(callback).toContain("isDvhsCsfGoogleImportBinding(binding)");
    expect(callback).toContain("? {}\n          : { email: calendarEmail }");
    expect(callback).not.toContain(
      'success: "connected",\n        email: calendarEmail',
    );
  });

  test("persists and reloads only durable server-side binding evidence", () => {
    const store = readSource("lib/auth/google-oauth-connection-store.ts");

    expect(store).toContain(
      '.select("connection_id, identity_email, identity_verified_at")',
    );
    expect(store).toContain("p_identity_email: input.identityEmail");
    expect(store).toContain("p_identity_verified_at: input.identityVerifiedAt");
    expect(store).toContain("binding_identity_email: binding.identityEmail");
    expect(store).toContain(
      "binding_identity_verified_at: binding.identityVerifiedAt",
    );
  });

  test("fails CSF token reads closed before use and after a slow refresh", () => {
    const service = readSource("services/calendar-operations.ts");
    const identityChecks = [
      ...service.matchAll(/googleOAuthConnectionHasVerifiedCsfIdentity\(/gu),
    ];
    const refresh = service.indexOf(
      "refreshAccessToken(decryptedRefreshToken)",
    );
    const finalIdentityCheck = service.lastIndexOf(
      "googleOAuthConnectionHasVerifiedCsfIdentity(",
    );

    expect(identityChecks).toHaveLength(2);
    expect(refresh).toBeGreaterThan(-1);
    expect(finalIdentityCheck).toBeGreaterThan(refresh);
  });

  test("preserves remote revocation when local credential cleanup fails", () => {
    const service = readSource("services/calendar-operations.ts");
    const deleteFailure = service.slice(
      service.indexOf("if (deactivateError)"),
      service.indexOf("return { success: true, remoteRevocation"),
    );

    expect(deleteFailure).toContain("success: false");
    expect(deleteFailure).toContain("remoteRevocation,");
    expect(deleteFailure).toContain('localCleanup: "failed"');
  });
});
