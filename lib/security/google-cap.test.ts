import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const adminCalls = {
  getUserById: 0,
  signOut: [] as Array<[string, string | undefined]>,
  updates: [] as Array<[string, Record<string, unknown>]>,
};

let appMetadata: Record<string, unknown> = {};
let updateError: { name: string; message: string; status: number } | null =
  null;

const adminClient = {
  auth: {
    admin: {
      getUserById: async (userId: string) => {
        adminCalls.getUserById += 1;
        return {
          data: { user: { id: userId, app_metadata: appMetadata } },
          error: null,
        };
      },
      signOut: async (userId: string, scope?: string) => {
        adminCalls.signOut.push([userId, scope]);
        return { error: null };
      },
      updateUserById: async (
        userId: string,
        attributes: Record<string, unknown>,
      ) => {
        adminCalls.updates.push([userId, attributes]);
        return {
          data: { user: updateError ? null : { id: userId } },
          error: updateError,
        };
      },
    },
  },
};

mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => adminClient,
}));

const {
  getGoogleCapEventDescriptor,
  getGoogleSigninCapRestriction,
  GOOGLE_CAP_EVENT_TYPES,
  GoogleCapValidationError,
  handleGoogleCapPayload,
  validateGoogleCapToken,
} = await import("./google-cap");
import type { DecodedGoogleCapToken } from "./google-cap";

const USER_ID = "33333333-3333-4333-8333-333333333333";
const GOOGLE_SUBJECT = "google-subject-123";

function payload(
  eventType: string,
  details: Record<string, unknown>,
  iat = 1_786_560_000,
): DecodedGoogleCapToken {
  return {
    iss: "https://accounts.google.com/",
    aud: "development-client-id",
    iat,
    jti: `event-${iat}`,
    events: { [eventType]: details },
  };
}

function userSubject() {
  return {
    subject: {
      subject_type: "iss-sub",
      iss: "https://accounts.google.com/",
      sub: GOOGLE_SUBJECT,
    },
  };
}

beforeEach(() => {
  adminCalls.getUserById = 0;
  adminCalls.signOut.length = 0;
  adminCalls.updates.length = 0;
  appMetadata = {};
  updateError = null;
});

describe("Google CAP event semantics", () => {
  test("requires an explicit CAP environment binding without OAuth fallback", async () => {
    const originalCapEnvironment = process.env.GOOGLE_CAP_ENVIRONMENT;
    const originalCapClientIds = process.env.GOOGLE_CAP_CLIENT_IDS;
    const originalGoogleClientId = process.env.GOOGLE_CLIENT_ID;
    const originalVercelEnvironment = process.env.VERCEL_ENV;
    delete process.env.GOOGLE_CAP_ENVIRONMENT;
    delete process.env.GOOGLE_CAP_CLIENT_IDS;
    delete process.env.VERCEL_ENV;
    process.env.GOOGLE_CLIENT_ID =
      "generic-oauth-client.apps.googleusercontent.com";

    try {
      await expect(validateGoogleCapToken("a.a.a")).rejects.toThrow(
        "GOOGLE_CAP_ENVIRONMENT",
      );
    } finally {
      if (originalCapEnvironment === undefined) {
        delete process.env.GOOGLE_CAP_ENVIRONMENT;
      } else {
        process.env.GOOGLE_CAP_ENVIRONMENT = originalCapEnvironment;
      }
      if (originalCapClientIds === undefined) {
        delete process.env.GOOGLE_CAP_CLIENT_IDS;
      } else {
        process.env.GOOGLE_CAP_CLIENT_IDS = originalCapClientIds;
      }
      if (originalGoogleClientId === undefined) {
        delete process.env.GOOGLE_CLIENT_ID;
      } else {
        process.env.GOOGLE_CLIENT_ID = originalGoogleClientId;
      }
      if (originalVercelEnvironment === undefined) {
        delete process.env.VERCEL_ENV;
      } else {
        process.env.VERCEL_ENV = originalVercelEnvironment;
      }
    }
  });

  test("classifies a malformed protected header as invalid input", async () => {
    const originalFetch = globalThis.fetch;
    const originalCapEnvironment = process.env.GOOGLE_CAP_ENVIRONMENT;
    const originalClientIds = process.env.GOOGLE_CAP_CLIENT_IDS;
    const originalVercelEnvironment = process.env.VERCEL_ENV;
    process.env.GOOGLE_CAP_ENVIRONMENT = "local";
    process.env.GOOGLE_CAP_CLIENT_IDS = "synthetic-client-id";
    delete process.env.VERCEL_ENV;
    globalThis.fetch = Object.assign(
      async () =>
        Response.json({
          issuer: "https://accounts.google.com/",
          jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
        }),
      { preconnect: originalFetch.preconnect },
    );

    try {
      await expect(validateGoogleCapToken("a.a.a")).rejects.toBeInstanceOf(
        GoogleCapValidationError,
      );
    } finally {
      globalThis.fetch = originalFetch;
      if (originalCapEnvironment === undefined) {
        delete process.env.GOOGLE_CAP_ENVIRONMENT;
      } else {
        process.env.GOOGLE_CAP_ENVIRONMENT = originalCapEnvironment;
      }
      if (originalClientIds === undefined) {
        delete process.env.GOOGLE_CAP_CLIENT_IDS;
      } else {
        process.env.GOOGLE_CAP_CLIENT_IDS = originalClientIds;
      }
      if (originalVercelEnvironment === undefined) {
        delete process.env.VERCEL_ENV;
      } else {
        process.env.VERCEL_ENV = originalVercelEnvironment;
      }
    }
  });

  test("keeps transient JWKS retrieval failures retryable", async () => {
    const originalFetch = globalThis.fetch;
    const originalCapEnvironment = process.env.GOOGLE_CAP_ENVIRONMENT;
    const originalClientIds = process.env.GOOGLE_CAP_CLIENT_IDS;
    const originalVercelEnvironment = process.env.VERCEL_ENV;
    process.env.GOOGLE_CAP_ENVIRONMENT = "local";
    process.env.GOOGLE_CAP_CLIENT_IDS = "synthetic-client-id";
    delete process.env.VERCEL_ENV;
    globalThis.fetch = Object.assign(
      async (input: string | URL | Request) => {
        const url =
          input instanceof Request
            ? input.url
            : input instanceof URL
              ? input.href
              : input;
        if (url.includes(".well-known/risc-configuration")) {
          return Response.json({
            issuer: "https://accounts.google.com/",
            jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
          });
        }
        throw new TypeError("synthetic JWKS network outage");
      },
      { preconnect: originalFetch.preconnect },
    );

    try {
      const rejection = validateGoogleCapToken(
        "eyJhbGciOiJSUzI1NiIsImtpZCI6InN5bnRoZXRpYyJ9.e30.c2ln",
      );
      await expect(rejection).rejects.toThrow("synthetic JWKS network outage");
      await expect(rejection).rejects.not.toBeInstanceOf(
        GoogleCapValidationError,
      );
    } finally {
      globalThis.fetch = originalFetch;
      if (originalCapEnvironment === undefined) {
        delete process.env.GOOGLE_CAP_ENVIRONMENT;
      } else {
        process.env.GOOGLE_CAP_ENVIRONMENT = originalCapEnvironment;
      }
      if (originalClientIds === undefined) {
        delete process.env.GOOGLE_CAP_CLIENT_IDS;
      } else {
        process.env.GOOGLE_CAP_CLIENT_IDS = originalClientIds;
      }
      if (originalVercelEnvironment === undefined) {
        delete process.env.VERCEL_ENV;
      } else {
        process.env.VERCEL_ENV = originalVercelEnvironment;
      }
    }
  });

  test("requires a user subject for every actionable token revocation shape", () => {
    for (const eventType of [
      GOOGLE_CAP_EVENT_TYPES.sessionsRevoked,
      GOOGLE_CAP_EVENT_TYPES.tokensRevoked,
      GOOGLE_CAP_EVENT_TYPES.tokenRevoked,
      GOOGLE_CAP_EVENT_TYPES.accountDisabled,
      GOOGLE_CAP_EVENT_TYPES.accountEnabled,
      GOOGLE_CAP_EVENT_TYPES.accountCredentialChangeRequired,
    ]) {
      expect(() => getGoogleCapEventDescriptor(payload(eventType, {}))).toThrow(
        GoogleCapValidationError,
      );
    }
  });

  test("rejects a subject issued by another identity provider", () => {
    expect(() =>
      getGoogleCapEventDescriptor(
        payload(GOOGLE_CAP_EVENT_TYPES.sessionsRevoked, {
          subject: {
            subject_type: "iss-sub",
            iss: "https://attacker.invalid/",
            sub: GOOGLE_SUBJECT,
          },
        }),
      ),
    ).toThrow(GoogleCapValidationError);
  });

  test("rejects malformed subject namespace types as invalid input", () => {
    for (const subject of [
      {
        subject_type: "email",
        iss: "https://accounts.google.com/",
        sub: GOOGLE_SUBJECT,
      },
      {
        subject_type: "iss-sub",
        iss: 42,
        sub: GOOGLE_SUBJECT,
      },
      {
        subject_type: "iss-sub",
        iss: "https://accounts.google.com/",
        sub: 42,
      },
    ]) {
      expect(() =>
        getGoogleCapEventDescriptor(
          payload(GOOGLE_CAP_EVENT_TYPES.sessionsRevoked, { subject }),
        ),
      ).toThrow(GoogleCapValidationError);
    }
  });

  test("globally terminates sessions through supported admin user update", async () => {
    const result = await handleGoogleCapPayload(
      payload(GOOGLE_CAP_EVENT_TYPES.tokenRevoked, userSubject()),
      USER_ID,
    );

    expect(result).toEqual({
      actionCount: 1,
      errorCount: 0,
      safeOutcome: "sessions_terminated",
    });
    expect(adminCalls.signOut).toHaveLength(0);
    expect(adminCalls.updates).toHaveLength(1);
    expect(adminCalls.updates[0]?.[0]).toBe(USER_ID);
    expect(adminCalls.updates[0]?.[1]).toEqual({
      password: expect.stringMatching(/^[A-Za-z0-9_-]{64,}$/u),
    });
  });

  test("never lets an older account-enabled event undo a newer disable", async () => {
    appMetadata = {
      security: {
        google_signin_disabled: true,
        google_cap_last_state_iat: 1_900_000_000,
      },
    };

    const result = await handleGoogleCapPayload(
      payload(GOOGLE_CAP_EVENT_TYPES.accountEnabled, userSubject()),
      USER_ID,
    );

    expect(result).toEqual({
      actionCount: 0,
      errorCount: 0,
      safeOutcome: "stale_enable_ignored",
    });
    expect(adminCalls.updates).toHaveLength(0);
  });

  test("never lets an older account-disabled event undo a newer enable", async () => {
    appMetadata = {
      security: {
        google_signin_disabled: false,
        google_cap_last_state_iat: 1_900_000_000,
      },
    };

    const result = await handleGoogleCapPayload(
      payload(GOOGLE_CAP_EVENT_TYPES.accountDisabled, {
        ...userSubject(),
        reason: "hijacking",
      }),
      USER_ID,
    );

    expect(result).toEqual({
      actionCount: 1,
      errorCount: 0,
      safeOutcome: "stale_disable_sessions_terminated",
    });
    expect(adminCalls.signOut).toHaveLength(0);
    expect(adminCalls.updates).toHaveLength(1);
    expect(adminCalls.updates[0]?.[1]).toEqual({
      password: expect.stringMatching(/^[A-Za-z0-9_-]{64,}$/u),
    });
  });

  test("equal-second enable cannot undo a fail-closed disabled state", async () => {
    appMetadata = {
      security: {
        google_signin_disabled: true,
        google_signin_disabled_reason: "account_disabled_hijacking",
        google_cap_last_state_iat: 1_786_560_000,
        google_cap_last_state_rank: 30,
      },
    };

    const result = await handleGoogleCapPayload(
      payload(
        GOOGLE_CAP_EVENT_TYPES.accountEnabled,
        userSubject(),
        1_786_560_000,
      ),
      USER_ID,
    );

    expect(result).toEqual({
      actionCount: 0,
      errorCount: 0,
      safeOutcome: "stale_enable_ignored",
    });
    expect(adminCalls.updates).toHaveLength(0);
  });

  test("a stale hijacking retry still revokes sessions after metadata changed", async () => {
    appMetadata = {
      security: {
        google_signin_disabled: false,
        google_cap_last_state_iat: 1_900_000_000,
        google_cap_last_state_rank: 0,
      },
    };

    const result = await handleGoogleCapPayload(
      payload(GOOGLE_CAP_EVENT_TYPES.accountDisabled, {
        ...userSubject(),
        reason: "hijacking",
      }),
      USER_ID,
    );

    expect(result).toEqual({
      actionCount: 1,
      errorCount: 0,
      safeOutcome: "stale_disable_sessions_terminated",
    });
    expect(adminCalls.updates).toHaveLength(1);
    expect(adminCalls.updates[0]?.[1]).toEqual({
      password: expect.stringMatching(/^[A-Za-z0-9_-]{64,}$/u),
    });
  });

  test("writes bounded event-time metadata for a hijacking disable", async () => {
    const capPayload = payload(
      GOOGLE_CAP_EVENT_TYPES.accountDisabled,
      { ...userSubject(), reason: "hijacking" },
      1_786_560_000,
    );
    const result = await handleGoogleCapPayload(capPayload, USER_ID);

    expect(result).toEqual({
      actionCount: 2,
      errorCount: 0,
      safeOutcome: "google_signin_disabled",
    });
    expect(adminCalls.signOut).toHaveLength(0);
    expect(adminCalls.updates).toHaveLength(1);
    expect(adminCalls.updates[0]?.[1]).toEqual({
      password: expect.stringMatching(/^[A-Za-z0-9_-]{64,}$/u),
      app_metadata: {
        security: {
          google_signin_disabled: true,
          google_signin_disabled_reason: "account_disabled_hijacking",
          google_signin_disabled_at: "2026-08-12T18:40:00.000Z",
          google_signin_reenabled_at: null,
          google_cap_last_state_iat: 1_786_560_000,
          google_cap_last_state_rank: 30,
        },
      },
    });
  });

  test("credential-change-required fails closed and revokes sessions", async () => {
    const result = await handleGoogleCapPayload(
      payload(
        GOOGLE_CAP_EVENT_TYPES.accountCredentialChangeRequired,
        userSubject(),
      ),
      USER_ID,
    );

    expect(result).toEqual({
      actionCount: 2,
      errorCount: 0,
      safeOutcome: "credential_change_required",
    });
    expect(adminCalls.updates).toHaveLength(1);
    expect(adminCalls.updates[0]?.[1]).toEqual({
      password: expect.stringMatching(/^[A-Za-z0-9_-]{64,}$/u),
      app_metadata: {
        security: {
          google_signin_disabled: true,
          google_signin_disabled_reason: "credential_change_required",
          google_signin_disabled_at: "2026-08-12T18:40:00.000Z",
          google_signin_reenabled_at: null,
          google_cap_last_state_iat: 1_786_560_000,
          google_cap_last_state_rank: 40,
        },
      },
    });
  });

  test("reads the platform sign-in restriction without trusting malformed metadata", () => {
    expect(getGoogleSigninCapRestriction(null)).toEqual({
      disabled: false,
      reason: null,
    });
    expect(
      getGoogleSigninCapRestriction({
        security: {
          google_signin_disabled: true,
          google_signin_disabled_reason: 42,
        },
      }),
    ).toEqual({ disabled: true, reason: null });
  });
});
