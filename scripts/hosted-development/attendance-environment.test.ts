import { expect, test } from "bun:test";
import type { BrowserContext, Route } from "@playwright/test";
import type { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cleanupAttendanceFixture,
  prepareHostedContext,
  signInHostedFixture,
} from "../../tests/e2e/attendance/environment";

const appUrl = "https://dev.lets-assist.com";
const serviceSecret = "sb_secret_never_enters_browser";
const cookie = {
  name: "_vercel_jwt",
  value: "fictional-bypass-cookie",
  domain: "dev.lets-assist.com",
  path: "/",
  httpOnly: true,
  secure: true,
  sameSite: "Lax" as const,
};

test("fresh hosted contexts receive only the scoped bypass cookie and block external navigation", async () => {
  const cookies: unknown[] = [];
  let navigationGuard: ((route: Route) => Promise<void>) | undefined;
  const context = {
    addCookies: async (value: unknown) => {
      cookies.push(value);
    },
    route: async (_pattern: string, handler: typeof navigationGuard) => {
      navigationGuard = handler;
    },
  } as unknown as BrowserContext;
  const input = {
    appUrl,
    protectionBypass: "fixture-bypass",
    serviceRoleKey: serviceSecret,
  };
  await prepareHostedContext(context, input, async (request) => {
    expect(Object.keys(request).sort()).toEqual([
      "appUrl",
      "path",
      "protectionBypass",
    ]);
    expect(request.appUrl.origin).toBe(appUrl);
    return cookie;
  });
  expect(cookies).toEqual([[cookie]]);
  expect(JSON.stringify(cookies)).not.toContain(serviceSecret);
  expect(JSON.stringify(cookies)).not.toContain("auth-token");
  for (const [url, navigation, expected] of [
    [`${appUrl}/anonymous/fixture`, true, "continued"],
    ["https://lets-assist.com/", true, "blocked"],
    ["https://thirdparty.test/script.js", false, "continued"],
  ] as const) {
    let outcome = "";
    await navigationGuard!({
      request: () => ({
        isNavigationRequest: () => navigation,
        resourceType: () => (navigation ? "document" : "script"),
        url: () => url,
      }),
      abort: async () => {
        outcome = "blocked";
      },
      continue: async () => {
        outcome = "continued";
      },
    } as unknown as Route);
    expect(outcome).toBe(expected);
  }
});

test("hosted sessions authenticate only fictional identities with the publishable key", async () => {
  const browserCookies: unknown[] = [];
  const context = {
    addCookies: async (cookies: unknown) => {
      browserCookies.push(cookies);
    },
  } as unknown as BrowserContext;
  const account = {
    email: "attendance.walkin.1234abcd@local.test",
    password: "fixture-password",
    userId: "fixture-id",
  };
  const target = {
    appUrl,
    url: "https://abcdefghijklmnopqrst.supabase.co",
    publishableKey: "sb_publishable_fixture",
    serviceRoleKey: serviceSecret,
  };
  const factory = ((
    url: string,
    key: string,
    options: { cookies: { setAll: (cookies: unknown[]) => void } },
  ) => {
    expect(url).toBe(target.url);
    expect(key).toBe(target.publishableKey);
    return {
      auth: {
        signInWithPassword: async (credentials: unknown) => {
          expect(credentials).toEqual({
            email: account.email,
            password: account.password,
          });
          options.cookies.setAll([
            {
              name: "sb-fixture-auth-token",
              value: "fictional-auth-cookie",
              options: {},
            },
          ]);
          return {
            error: null,
            data: { user: { id: account.userId }, session: {} },
          };
        },
      },
    };
  }) as unknown as typeof createServerClient;
  await signInHostedFixture(context, target, account, factory);
  expect(browserCookies).toEqual([
    [
      {
        name: "sb-fixture-auth-token",
        value: "fictional-auth-cookie",
        url: appUrl,
        secure: true,
        sameSite: "Lax",
      },
    ],
  ]);
  expect(JSON.stringify(browserCookies)).not.toContain(serviceSecret);
  expect(JSON.stringify(browserCookies)).not.toContain(account.password);
  await expect(
    signInHostedFixture(
      context,
      target,
      { ...account, email: "real@example.com" },
      factory,
    ),
  ).rejects.toThrow("fictional");
});

test("cleanup deletes certificate snapshots before the project and checks only fixture IDs", async () => {
  const operations: string[] = [];
  const admin = {
    from: (table: string) => ({
      delete: () => ({
        eq: async (column: string, value: string) => {
          expect(value).toBe("fixture-project");
          expect(column).toBe(table === "projects" ? "id" : "project_id");
          operations.push(`delete:${table}`);
          return { error: null };
        },
      }),
      select: () => ({
        eq: async (column: string, value: string) => {
          expect(value).toBe(
            table === "profiles" ? "fixture-user" : "fixture-project",
          );
          expect(column).toBe(
            ["projects", "profiles"].includes(table) ? "id" : "project_id",
          );
          operations.push(`verify:${table}`);
          return { error: null, count: 0 };
        },
      }),
    }),
    auth: {
      admin: {
        deleteUser: async (id: string) => {
          expect(id).toBe("fixture-user");
          operations.push("delete:auth-user");
          return { error: null };
        },
      },
    },
  } as unknown as SupabaseClient;
  expect(
    await cleanupAttendanceFixture(admin, "fixture-project", [
      "fixture-user",
      null,
    ]),
  ).toEqual([]);
  expect(operations.slice(0, 2)).toEqual([
    "delete:certificates",
    "delete:projects",
  ]);
  expect(operations).toContain("verify:paper_signup_notification_outbox");
  expect(operations).toContain("verify:hours_publication_receipts");
  expect(operations.at(-1)).toBe("verify:profiles");
});

test("cleanup refuses project deletion when its certificate cleanup fails and returns no provider payload", async () => {
  const admin = {
    from: () => ({
      delete: () => ({
        eq: async () => ({ error: { message: serviceSecret } }),
      }),
    }),
  } as unknown as SupabaseClient;
  const result = await cleanupAttendanceFixture(admin, "fixture-project", []);
  expect(result).toEqual(["fixture_certificates_cleanup_failed"]);
  expect(JSON.stringify(result)).not.toContain(serviceSecret);
});
