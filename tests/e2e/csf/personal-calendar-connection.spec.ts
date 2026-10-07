import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { getCsfIsolatedSupabaseEnv } from "../../../scripts/local-dev/dv-local-env.mjs";
import { localTestPassword, loginWithEmail } from "./helpers";

function checked(error: unknown, operation: string) {
  if (error)
    throw new Error(`Fictional connected calendar ${operation} failed.`);
}

test("connected calendar protects credentials and supports local-only disconnect", async ({
  page,
}) => {
  const local = getCsfIsolatedSupabaseEnv();
  const clientOptions = {
    auth: { autoRefreshToken: false, persistSession: false },
  };
  const admin = createClient(local.url, local.serviceRoleKey, clientOptions);
  const member = createClient(local.url, local.anonKey, clientOptions);
  const runId = randomUUID();
  const connectionId = randomUUID();
  const email = `calendar.connected.${runId}@local.test`;
  const calendarEmail = `calendar.display.${runId}@local.test`;
  const accessToken = `fictional-encrypted-access-${runId}`;
  const refreshToken = `fictional-encrypted-refresh-${runId}`;
  const privateMarker = `private-preferences-${runId}`;
  const bindingTimestamp = "2039-09-02T12:34:56.000Z";
  const calendarBodies: Array<Promise<{ type: string; body: string }>> = [];
  const externalRequests: string[] = [];
  const browserFailures: string[] = [];
  function isCredentialProbe(url: string) {
    try {
      const parsed = new URL(url);
      return (
        parsed.origin === new URL(local.url).origin &&
        parsed.pathname === "/rest/v1/user_calendar_connections" &&
        parsed.searchParams.get("id") === `eq.${connectionId}`
      );
    } catch {
      return false;
    }
  }
  page.on("pageerror", (error) =>
    browserFailures.push(`pageerror: ${error.message}`),
  );
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (
      isCredentialProbe(message.location().url) &&
      message.text().includes("the server responded with a status of 403")
    )
      return;
    browserFailures.push(`console: ${message.text()}`);
  });
  page.on("requestfailed", (request) => {
    if (request.failure()?.errorText === "net::ERR_ABORTED") return;
    browserFailures.push(`requestfailed: ${new URL(request.url()).pathname}`);
  });
  let userId: string | undefined;
  const failures: unknown[] = [];

  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
      await route.continue();
    } else {
      externalRequests.push(url.origin);
      await route.abort("blockedbyclient");
    }
  });
  page.on("response", (response) => {
    if (
      response.status() >= 400 &&
      !(response.status() === 403 && isCredentialProbe(response.url()))
    ) {
      browserFailures.push(
        `response: ${response.status()} ${new URL(response.url()).pathname}`,
      );
    }
    if (new URL(response.url()).pathname !== "/account/calendar") return;
    const type = response.headers()["content-type"] ?? "";
    if (type.includes("text/html") || type.includes("text/x-component")) {
      calendarBodies.push(
        response
          .text()
          .then((body) => ({ type, body }))
          .catch(() => {
            browserFailures.push(
              "Calendar response body could not be captured.",
            );
            return { type, body: "" };
          }),
      );
    }
  });

  try {
    const created = await admin.auth.admin.createUser({
      email,
      password: localTestPassword(),
      email_confirm: true,
      user_metadata: { full_name: "Connected calendar fixture" },
    });
    checked(created.error, "account creation");
    userId = created.data.user?.id;
    if (!userId)
      throw new Error("Fictional connected calendar account missing.");
    checked(
      (
        await admin.from("user_calendar_connections").insert({
          id: connectionId,
          user_id: userId,
          provider: "google",
          connection_type: "calendar",
          calendar_email: calendarEmail,
          access_token: accessToken,
          refresh_token: refreshToken,
          token_expires_at: "2039-10-01T12:00:00.000Z",
          is_active: true,
          granted_scopes:
            "https://www.googleapis.com/auth/calendar.app.created",
          created_at: "2039-09-01T12:00:00.000Z",
          preferences: { private_fixture_marker: privateMarker },
        })
      ).error,
      "credential fixture creation",
    );
    checked(
      (
        await admin.from("user_google_oauth_connection_bindings").insert({
          connection_id: connectionId,
          user_id: userId,
          provider: "google",
          purpose: "personal_calendar",
          created_at: bindingTimestamp,
        })
      ).error,
      "purpose binding creation",
    );

    await loginWithEmail(page, email, "/account/security");
    await page
      .getByRole("link", { name: "Calendar Sync & integrations", exact: true })
      .click();
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();
    await expect(page.getByText(calendarEmail, { exact: true })).toBeVisible();
    await expect(
      page.getByText("Connected on September 1, 2039", { exact: true }),
    ).toBeVisible();
    await Promise.all(calendarBodies);
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByText(calendarEmail, { exact: true })).toBeVisible();
    const bodies = await Promise.all(calendarBodies);
    expect(bodies.some(({ type }) => type.includes("text/html"))).toBe(true);
    expect(
      bodies.some(
        ({ type, body }) =>
          type.includes("text/x-component") && body.includes(calendarEmail),
      ),
    ).toBe(true);
    for (const { body } of bodies) {
      for (const forbidden of [
        accessToken,
        refreshToken,
        privateMarker,
        connectionId,
        bindingTimestamp,
        "private_fixture_marker",
      ]) {
        expect(body.includes(forbidden)).toBe(false);
      }
    }

    const signedIn = await member.auth.signInWithPassword({
      email,
      password: localTestPassword(),
    });
    checked(signedIn.error, "REST session creation");
    const bearer = signedIn.data.session?.access_token;
    if (!bearer) throw new Error("Fictional REST session missing.");
    const refusals = await page.evaluate(
      async ({ url, anonKey, bearer, connectionId }) => {
        const endpoint = `${url}/rest/v1/user_calendar_connections?id=eq.${connectionId}`;
        const results = [];
        for (const method of ["GET", "PATCH", "DELETE"]) {
          const response = await fetch(
            `${endpoint}&select=id,access_token,refresh_token`,
            {
              method,
              headers: {
                apikey: anonKey,
                Authorization: `Bearer ${bearer}`,
                "Content-Type": "application/json",
              },
              ...(method === "PATCH"
                ? { body: JSON.stringify({ is_active: false }) }
                : {}),
            },
          );
          const result = await response.json();
          results.push({ method, status: response.status, code: result.code });
        }
        return results;
      },
      { url: local.url, anonKey: local.anonKey, bearer, connectionId },
    );
    expect(refusals).toEqual([
      { method: "GET", status: 403, code: "42501" },
      { method: "PATCH", status: 403, code: "42501" },
      { method: "DELETE", status: 403, code: "42501" },
    ]);
    const retained = await admin
      .from("user_calendar_connections")
      .select("id,is_active,access_token,refresh_token")
      .eq("id", connectionId)
      .eq("user_id", userId)
      .single();
    checked(retained.error, "credential readback");
    expect(retained.data).toEqual({
      id: connectionId,
      is_active: true,
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    const disconnected = await page.evaluate(async () => {
      const response = await fetch("/api/google/oauth/disconnect", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revoke_access: false }),
      });
      return { status: response.status, body: await response.json() };
    });
    expect(disconnected).toMatchObject({
      status: 200,
      body: { success: true, remoteRevocation: "not_requested" },
    });
    const removedCredential = await admin
      .from("user_calendar_connections")
      .select("id")
      .eq("id", connectionId)
      .eq("user_id", userId)
      .maybeSingle();
    const removedBinding = await admin
      .from("user_google_oauth_connection_bindings")
      .select("connection_id")
      .eq("connection_id", connectionId)
      .eq("user_id", userId)
      .maybeSingle();
    checked(removedCredential.error, "disconnected credential readback");
    checked(removedBinding.error, "disconnected binding readback");
    expect(removedCredential.data).toBeNull();
    expect(removedBinding.data).toBeNull();
    await page.reload({ waitUntil: "networkidle" });
    await expect(
      page.getByText("Not connected", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Connect Google Calendar",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByText(calendarEmail, { exact: true })).toHaveCount(0);
    await Promise.all(calendarBodies);
    expect(externalRequests).toEqual([]);
    expect(browserFailures).toEqual([]);
  } catch (error) {
    failures.push(error);
  } finally {
    try {
      await page.close();
    } catch {
      failures.push(new Error("Fixture page cleanup failed."));
    }
    if (userId) {
      for (const cleanup of [
        async () =>
          (
            await admin
              .from("user_calendar_connections")
              .delete()
              .eq("id", connectionId)
              .eq("user_id", userId)
          ).error,
        async () => (await admin.auth.admin.deleteUser(userId!)).error,
      ]) {
        try {
          checked(await cleanup(), "cleanup");
        } catch {
          failures.push(
            new Error("Fictional connected calendar cleanup failed."),
          );
        }
      }
    }
  }
  if (failures.length) {
    throw new AggregateError(failures, "Connected calendar acceptance failed.");
  }
});
