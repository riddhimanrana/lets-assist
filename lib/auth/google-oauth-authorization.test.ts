import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mock } from "bun:test";

mock.module("server-only", () => ({}));

const {
  evaluateGoogleOAuthOrganizationAuthorization,
  getGoogleOAuthRequiredScopeFamily,
  resolveGoogleOAuthRequestIntent,
} = await import("./google-oauth-authorization");

const ORGANIZATION_ID = "22222222-2222-4222-8222-222222222222";
const csfImportIntent = {
  organizationId: ORGANIZATION_ID,
  pluginKey: "dvhs-csf" as const,
  purpose: "csf_import" as const,
  requestedCapability: "import_members" as const,
};

test("allows a CSF staff member only for the capability bound into state", () => {
  assert.deepEqual(
    evaluateGoogleOAuthOrganizationAuthorization(csfImportIntent, {
      membershipRole: "staff",
      membershipStatus: "active",
      pluginAvailable: true,
      isCsfOwner: false,
      permissions: new Set(["import_members"]),
    }),
    { allowed: true },
  );

  assert.deepEqual(
    evaluateGoogleOAuthOrganizationAuthorization(
      { ...csfImportIntent, requestedCapability: "import_applications" },
      {
        membershipRole: "staff",
        membershipStatus: "active",
        pluginAvailable: true,
        isCsfOwner: false,
        permissions: new Set(["import_members"]),
      },
    ),
    { allowed: false, reason: "capability_required" },
  );
});

test("keeps organization calendar and report connections admin-only", () => {
  assert.deepEqual(
    evaluateGoogleOAuthOrganizationAuthorization(
      {
        organizationId: ORGANIZATION_ID,
        pluginKey: null,
        purpose: "organization_sheets",
        requestedCapability: null,
      },
      {
        membershipRole: "staff",
        membershipStatus: "active",
        pluginAvailable: true,
        isCsfOwner: true,
        permissions: new Set(["import_members"]),
      },
    ),
    { allowed: false, reason: "org_admin_required" },
  );
});

test("allows an organization admin and fails closed when the CSF plugin is unavailable", () => {
  assert.deepEqual(
    evaluateGoogleOAuthOrganizationAuthorization(csfImportIntent, {
      membershipRole: "admin",
      membershipStatus: "active",
      pluginAvailable: true,
      isCsfOwner: false,
      permissions: new Set(),
    }),
    { allowed: true },
  );

  assert.deepEqual(
    evaluateGoogleOAuthOrganizationAuthorization(csfImportIntent, {
      membershipRole: "admin",
      membershipStatus: "active",
      pluginAvailable: false,
      isCsfOwner: false,
      permissions: new Set(),
    }),
    { allowed: false, reason: "plugin_unavailable" },
  );
});

test("denies every organization-bound shortcut when membership is inactive", () => {
  assert.deepEqual(
    evaluateGoogleOAuthOrganizationAuthorization(
      {
        organizationId: ORGANIZATION_ID,
        pluginKey: null,
        purpose: "organization_calendar",
        requestedCapability: null,
      },
      {
        membershipRole: "admin",
        membershipStatus: "inactive",
        pluginAvailable: true,
        isCsfOwner: false,
        permissions: new Set(),
      },
    ),
    { allowed: false, reason: "organization_membership_required" },
  );

  assert.deepEqual(
    evaluateGoogleOAuthOrganizationAuthorization(csfImportIntent, {
      membershipRole: "staff",
      membershipStatus: "inactive",
      pluginAvailable: true,
      isCsfOwner: true,
      permissions: new Set(["import_members"]),
    }),
    { allowed: false, reason: "organization_membership_required" },
  );

  assert.deepEqual(
    evaluateGoogleOAuthOrganizationAuthorization(csfImportIntent, {
      membershipRole: "admin",
      membershipStatus: null,
      pluginAvailable: true,
      isCsfOwner: false,
      permissions: new Set(),
    }),
    { allowed: false, reason: "organization_membership_required" },
  );
});

test("keeps personal connections independent from organization membership status", () => {
  assert.deepEqual(
    evaluateGoogleOAuthOrganizationAuthorization(
      {
        organizationId: null,
        pluginKey: null,
        purpose: "personal_sheets",
        requestedCapability: null,
      },
      {
        membershipRole: null,
        membershipStatus: null,
        pluginAvailable: false,
        isCsfOwner: false,
        permissions: new Set(),
      },
    ),
    { allowed: true },
  );
});

test("both OAuth endpoints use the active-membership authorization gate", () => {
  const authorizationSource = readFileSync(
    `${process.cwd()}/lib/auth/google-oauth-authorization.ts`,
    "utf8",
  );
  const connectSource = readFileSync(
    `${process.cwd()}/app/api/google/oauth/connect/route.ts`,
    "utf8",
  );
  const callbackSource = readFileSync(
    `${process.cwd()}/app/api/google/oauth/callback/route.ts`,
    "utf8",
  );

  assert.match(authorizationSource, /\.select\("role,status"\)/u);
  assert.match(authorizationSource, /facts\.membershipStatus !== "active"/u);
  assert.match(connectSource, /authorizeGoogleOAuthOrganizationRequest\(/u);
  assert.match(callbackSource, /authorizeGoogleOAuthOrganizationRequest\(/u);
  assert.ok(
    callbackSource.indexOf("authorizeGoogleOAuthOrganizationRequest({") <
      callbackSource.indexOf('fetch("https://oauth2.googleapis.com/token"'),
    "callback reauthorization must run before exchanging the OAuth code",
  );
});

test("resolves explicit CSF import intent without enabling organization sheet ownership", () => {
  assert.deepEqual(
    resolveGoogleOAuthRequestIntent({
      organizationId: ORGANIZATION_ID,
      pluginKey: "dvhs-csf",
      purpose: "csf_import",
      requestedCapability: "import_meetings",
      scopeType: "sheets",
      isCalendarSync: false,
      isSheetsSync: true,
    }),
    {
      ok: true,
      intent: {
        organizationId: ORGANIZATION_ID,
        pluginKey: "dvhs-csf",
        purpose: "csf_import",
        requestedCapability: "import_meetings",
        isCalendarSync: false,
        isSheetsSync: false,
      },
    },
  );
});

test("preserves legacy organization settings and personal Sheets intents", () => {
  assert.deepEqual(
    resolveGoogleOAuthRequestIntent({
      organizationId: ORGANIZATION_ID,
      pluginKey: null,
      purpose: null,
      requestedCapability: null,
      scopeType: "calendar",
      isCalendarSync: true,
      isSheetsSync: false,
    }),
    {
      ok: true,
      intent: {
        organizationId: ORGANIZATION_ID,
        pluginKey: null,
        purpose: "organization_calendar",
        requestedCapability: null,
        isCalendarSync: true,
        isSheetsSync: false,
      },
    },
  );

  assert.deepEqual(
    resolveGoogleOAuthRequestIntent({
      organizationId: null,
      pluginKey: null,
      purpose: null,
      requestedCapability: null,
      scopeType: "sheets",
      isCalendarSync: false,
      isSheetsSync: true,
    }),
    {
      ok: true,
      intent: {
        organizationId: null,
        pluginKey: null,
        purpose: "personal_sheets",
        requestedCapability: null,
        isCalendarSync: false,
        isSheetsSync: false,
      },
    },
  );
});

test("derives requested Google scopes from signed purpose rather than query aliases", () => {
  assert.equal(
    getGoogleOAuthRequiredScopeFamily("personal_calendar"),
    "calendar",
  );
  assert.equal(
    getGoogleOAuthRequiredScopeFamily("organization_calendar"),
    "calendar",
  );
  assert.equal(getGoogleOAuthRequiredScopeFamily("personal_sheets"), "sheets");
  assert.equal(
    getGoogleOAuthRequiredScopeFamily("organization_sheets"),
    "sheets",
  );
  assert.equal(getGoogleOAuthRequiredScopeFamily("csf_import"), "sheets");

  const explicitCalendar = resolveGoogleOAuthRequestIntent({
    organizationId: null,
    pluginKey: null,
    purpose: "personal_calendar",
    requestedCapability: null,
    scopeType: "sheets",
    isCalendarSync: false,
    isSheetsSync: false,
  });
  assert.equal(explicitCalendar.ok, true);
  if (explicitCalendar.ok) {
    assert.equal(
      getGoogleOAuthRequiredScopeFamily(explicitCalendar.intent.purpose),
      "calendar",
    );
  }
});

test("rejects malformed or unsupported capability-bound requests", () => {
  assert.deepEqual(
    resolveGoogleOAuthRequestIntent({
      organizationId: ORGANIZATION_ID,
      pluginKey: "dvhs-csf",
      purpose: "csf_import",
      requestedCapability: "manage_roles",
      scopeType: "sheets",
      isCalendarSync: false,
      isSheetsSync: false,
    }),
    { ok: false },
  );

  assert.deepEqual(
    resolveGoogleOAuthRequestIntent({
      organizationId: null,
      pluginKey: "dvhs-csf",
      purpose: "csf_import",
      requestedCapability: "import_members",
      scopeType: "sheets",
      isCalendarSync: false,
      isSheetsSync: false,
    }),
    { ok: false },
  );
});
