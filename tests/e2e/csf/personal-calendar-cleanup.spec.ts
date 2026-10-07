import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { getCsfIsolatedSupabaseEnv } from "../../../scripts/local-dev/dv-local-env.mjs";
import { localTestPassword, loginWithEmail } from "./helpers";

function checked(error: unknown, operation: string) {
  if (error) throw new Error(`Fictional calendar ${operation} failed.`);
}

test("orphan calendar cleanup stays visible through refused removal and rejects another account", async ({
  page,
  browser,
}) => {
  const local = getCsfIsolatedSupabaseEnv();
  const admin = createClient(local.url, local.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const users: Array<{ id: string; email: string }> = [];
  const projectId = randomUUID();
  const eventId = `fictional${randomUUID().replaceAll("-", "")}`;
  const otherContext = await browser.newContext();
  try {
    for (const role of ["owner", "other"]) {
      const email = `calendar.${role}.${randomUUID()}@local.test`;
      const created = await admin.auth.admin.createUser({
        email,
        password: localTestPassword(),
        email_confirm: true,
        user_metadata: { full_name: `Calendar ${role} fixture` },
      });
      checked(created.error, "account creation");
      if (!created.data.user)
        throw new Error("Fictional calendar account missing.");
      users.push({ id: created.data.user.id, email });
    }
    const [owner, other] = users;
    checked(
      (
        await admin.from("projects").insert({
          id: projectId,
          creator_id: owner.id,
          title: "Fictional calendar cleanup project",
          location: "Local fixture venue",
          description:
            "Synthetic legacy event ownership for browser acceptance.",
          event_type: "oneTime",
          verification_method: "manual",
          schedule: {
            oneTime: {
              date: "2030-10-10",
              startTime: "10:00",
              endTime: "12:00",
              volunteers: 20,
            },
          },
          status: "upcoming",
          workflow_status: "published",
          visibility: "unlisted",
          creator_calendar_event_id: eventId,
        })
      ).error,
      "project creation",
    );
    const claimed = await admin.rpc("claim_personal_calendar_sync", {
      p_actor_user_id: owner.id,
      p_source_kind: "project",
      p_source_id: projectId,
      p_operation: "remove",
      p_expected_event_id: eventId,
    });
    checked(claimed.error, "receipt claim");
    expect(claimed.data).toMatchObject({
      user_id: owner.id,
      source_id: projectId,
      phase: "removing",
    });
    checked(
      (
        await admin.rpc("advance_personal_calendar_sync", {
          p_actor_user_id: owner.id,
          p_source_kind: "project",
          p_source_id: projectId,
          p_claim_token: claimed.data.claim_token,
          p_step: "release",
        })
      ).error,
      "fixture lease release",
    );
    checked(
      (
        await admin
          .from("projects")
          .delete()
          .eq("id", projectId)
          .eq("creator_id", owner.id)
      ).error,
      "source deletion",
    );

    await loginWithEmail(page, owner.email, "/account/calendar");
    await expect(
      page.getByRole("heading", { name: "Calendar Settings", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Not connected", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Calendar entries awaiting removal", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Removed project", { exact: true }),
    ).toHaveCount(1);
    // No Google connection is created. The real handler must refuse before
    // provider access, retain the receipt, and release its lease for retry.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = page.waitForResponse(
        (candidate) =>
          new URL(candidate.url()).pathname === "/api/calendar/remove-event" &&
          candidate.request().method() === "DELETE",
      );
      await page
        .getByRole("button", { name: "Remove from calendar", exact: true })
        .click();
      expect((await response).status()).toBe(409);
      await expect(
        page
          .getByText("Connect or repair your Google Calendar before retrying", {
            exact: true,
          })
          .first(),
      ).toBeVisible();
      await expect(
        page.getByText("Removed project", { exact: true }),
      ).toHaveCount(1);
      await expect(
        page.getByText("Event Removed", { exact: true }),
      ).toHaveCount(0);
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("button", { name: "Remove from calendar", exact: true }),
    ).toBeVisible();

    const otherPage = await otherContext.newPage();
    await loginWithEmail(otherPage, other.email, "/account/calendar");
    await expect(
      otherPage.getByText("Calendar entries awaiting removal", { exact: true }),
    ).toHaveCount(0);
    const foreign = await otherPage.request.delete(
      new URL("/api/calendar/remove-event", otherPage.url()).toString(),
      {
        data: { event_id: eventId, event_type: "creator" },
      },
    );
    expect(foreign.status()).toBe(404);
    const remaining = await admin.rpc("list_personal_calendar_cleanup", {
      p_actor_user_id: owner.id,
    });
    checked(remaining.error, "retained receipt readback");
    expect(remaining.data).toEqual([
      { source_kind: "project", source_id: projectId, event_id: eventId },
    ]);
  } finally {
    await page.close();
    await otherContext.close();
    for (const { id } of users) {
      checked(
        (
          await admin
            .from("projects")
            .delete()
            .eq("id", projectId)
            .eq("creator_id", id)
        ).error,
        "project cleanup",
      );
      checked((await admin.auth.admin.deleteUser(id)).error, "account cleanup");
    }
  }
});
