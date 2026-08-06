import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NextResponse } from "next/server";

import {
  applyPrivateNoStore,
  canManageProjectRoute,
  classifyFreshUserValidation,
  hasSensitiveAuthQuery,
  isAuthSensitiveProxyPath,
  isSupabaseAuthCookieName,
  shouldApplyPrivateNoStore,
  shouldRedirectAuthenticatedRestrictedRequest,
} from "./proxy";

test("anonymous public responses retain route-owned cache policy", () => {
  const anonymousPublic = {
    hasIncomingAuthContext: false,
    authCookiesMutated: false,
    authenticated: false,
    authSensitiveRequest: false,
    isRedirect: false,
    responseStatus: 200,
  };

  assert.equal(shouldApplyPrivateNoStore(anonymousPublic), false);
  assert.equal(
    shouldApplyPrivateNoStore({ ...anonymousPublic, responseStatus: 304 }),
    false,
  );

  const source = readFileSync(`${process.cwd()}/lib/supabase/proxy.ts`, "utf8");
  const responseInitialization = source.slice(
    source.indexOf("let supabaseResponse = NextResponse.next"),
    source.indexOf("const applyPendingAuthCookies"),
  );

  assert.doesNotMatch(responseInitialization, /applyPrivateNoStore/u);
  assert.match(
    source,
    /shouldDisableSharedCaching = shouldApplyPrivateNoStore/u,
  );
});

test("auth context, mutation, redirects, errors, and sensitive routes disable shared caching", () => {
  const anonymousPublic = {
    hasIncomingAuthContext: false,
    authCookiesMutated: false,
    authenticated: false,
    authSensitiveRequest: false,
    isRedirect: false,
    responseStatus: 200,
  };

  assert.equal(
    shouldApplyPrivateNoStore({
      ...anonymousPublic,
      hasIncomingAuthContext: true,
    }),
    true,
  );
  assert.equal(
    shouldApplyPrivateNoStore({ ...anonymousPublic, authCookiesMutated: true }),
    true,
  );
  assert.equal(
    shouldApplyPrivateNoStore({ ...anonymousPublic, authenticated: true }),
    true,
  );
  assert.equal(
    shouldApplyPrivateNoStore({
      ...anonymousPublic,
      authSensitiveRequest: true,
    }),
    true,
  );
  assert.equal(
    shouldApplyPrivateNoStore({
      ...anonymousPublic,
      isRedirect: true,
      responseStatus: 307,
    }),
    true,
  );
  assert.equal(
    shouldApplyPrivateNoStore({ ...anonymousPublic, responseStatus: 503 }),
    true,
  );
});

test("proxy recognizes Supabase cookies and capability-bearing auth requests", () => {
  assert.equal(isSupabaseAuthCookieName("sb-project-ref-auth-token"), true);
  assert.equal(isSupabaseAuthCookieName("sb-access-token"), true);
  assert.equal(isSupabaseAuthCookieName("theme"), false);

  assert.equal(isAuthSensitiveProxyPath("/account/profile"), true);
  assert.equal(isAuthSensitiveProxyPath("/projects/project-1/edit"), true);
  assert.equal(isAuthSensitiveProxyPath("/organization/acme/settings"), true);
  assert.equal(isAuthSensitiveProxyPath("/auth/confirm"), true);
  assert.equal(isAuthSensitiveProxyPath("/reset-password/token"), true);
  assert.equal(isAuthSensitiveProxyPath("/projects"), false);
  assert.equal(isAuthSensitiveProxyPath("/projects/project-1"), false);
  assert.equal(isAuthSensitiveProxyPath("/organization/acme"), false);
  assert.equal(isAuthSensitiveProxyPath("/api/status"), false);

  assert.equal(
    hasSensitiveAuthQuery(new URLSearchParams("token=secret")),
    true,
  );
  assert.equal(
    hasSensitiveAuthQuery(new URLSearchParams("staff_token=invite")),
    true,
  );
  assert.equal(
    hasSensitiveAuthQuery(new URLSearchParams("email=user%40example.com")),
    true,
  );
  assert.equal(
    hasSensitiveAuthQuery(new URLSearchParams("page=2&sort=recent")),
    false,
  );
});

test("authenticated auth-page redirects do not intercept Server Action posts", () => {
  assert.equal(
    shouldRedirectAuthenticatedRestrictedRequest({
      method: "POST",
      hasNextActionHeader: true,
    }),
    false,
  );
  assert.equal(
    shouldRedirectAuthenticatedRestrictedRequest({
      method: "GET",
      hasNextActionHeader: true,
    }),
    true,
  );
  assert.equal(
    shouldRedirectAuthenticatedRestrictedRequest({
      method: "POST",
      hasNextActionHeader: false,
    }),
    true,
  );
  assert.equal(
    shouldRedirectAuthenticatedRestrictedRequest({
      method: "GET",
      hasNextActionHeader: false,
    }),
    true,
  );
});

test("private cache policy preserves unrelated response headers", () => {
  const response = new NextResponse("ok", {
    headers: { "X-Test": "preserved" },
  });

  applyPrivateNoStore(response);

  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response.headers.get("X-Test"), "preserved");
});

test("project management routes match creator and organization permissions", () => {
  const common = { creatorId: "creator", userId: "viewer" };

  assert.equal(canManageProjectRoute({ ...common, userId: "creator" }), true);
  assert.equal(
    canManageProjectRoute({ ...common, organizationRole: "admin" }),
    true,
  );
  assert.equal(
    canManageProjectRoute({
      ...common,
      organizationRole: "staff",
      canBeManagedByStaff: true,
    }),
    true,
  );
  assert.equal(
    canManageProjectRoute({
      ...common,
      organizationRole: "staff",
      canBeManagedByStaff: false,
    }),
    false,
  );
  assert.equal(
    canManageProjectRoute({ ...common, organizationRole: "member" }),
    false,
  );
});

test("proxy refreshes authoritative auth state before trusting account-access metadata", () => {
  const source = readFileSync(`${process.cwd()}/lib/supabase/proxy.ts`, "utf8");
  const claimsIndex = source.indexOf("await supabase.auth.getClaims()");
  const freshUserIndex = source.indexOf(
    "await supabase.auth.getUser()",
    claimsIndex,
  );
  const relativeAccessIndex = source
    .slice(freshUserIndex)
    .search(/readAccountAccessFromMetadata\(\s*user\.app_metadata/u);
  const accessIndex =
    relativeAccessIndex < 0 ? -1 : freshUserIndex + relativeAccessIndex;

  assert.ok(claimsIndex >= 0);
  assert.ok(freshUserIndex > claimsIndex);
  assert.ok(accessIndex > freshUserIndex);
  assert.match(source, /classifyFreshUserValidation/u);
  assert.match(source, /expectedUserId: claims\.sub/u);
  assert.match(source, /getAccountAccessErrorCode\("banned"\)/u);
});

test("fresh-user validation only clears authoritative invalid sessions", () => {
  assert.equal(
    classifyFreshUserValidation({
      error: { code: "user_banned", message: "User is banned" },
      expectedUserId: "user-1",
    }),
    "banned",
  );
  assert.equal(
    classifyFreshUserValidation({
      error: { code: "user_not_found", message: "User not found" },
      expectedUserId: "user-1",
    }),
    "clear_session",
  );
  assert.equal(
    classifyFreshUserValidation({
      error: {
        code: "request_timeout",
        message: "Upstream timeout",
        status: 503,
      },
      expectedUserId: "user-1",
    }),
    "retry",
  );
  assert.equal(
    classifyFreshUserValidation({
      freshUserId: "different-user",
      expectedUserId: "user-1",
    }),
    "clear_session",
  );
  assert.equal(
    classifyFreshUserValidation({
      freshUserId: "user-1",
      expectedUserId: "user-1",
    }),
    "valid",
  );
});

test("proxy preserves cookies and returns a no-store retry on transient auth or MFA errors", () => {
  const source = readFileSync(`${process.cwd()}/lib/supabase/proxy.ts`, "utf8");
  const retryStart = source.indexOf('if (validationDisposition === "retry")');
  const clearStart = source.indexOf(
    'validationDisposition === "banned" ||',
    retryStart,
  );
  const transientBranch = source.slice(retryStart, clearStart);

  assert.ok(retryStart >= 0);
  assert.ok(clearStart > retryStart);
  assert.match(transientBranch, /return authRetryResponse\(\)/u);
  assert.doesNotMatch(transientBranch, /signOut|clearAuthCookiesOnFinalize/u);
  assert.match(source, /status: 503/u);
  assert.match(source, /"Retry-After": "5"/u);
  assert.match(source, /applyPrivateNoStore/u);

  assert.match(source, /mfa\.getAuthenticatorAssuranceLevel\(\)/u);
  assert.match(source, /mfaState\.lookupError/u);
  assert.match(source, /return authRetryResponse\(\)/u);
});
