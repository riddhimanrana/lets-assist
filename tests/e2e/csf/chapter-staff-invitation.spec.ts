import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { getCsfIsolatedSupabaseEnv } from "../../../scripts/local-dev/dv-local-env.mjs";
import { fixtureJoinCode } from "../../../scripts/local-dev/seed-platform-fixtures.mjs";
import { localActors, loginAs } from "./helpers";

test("a chapter staff invitation is visible to its recipient and refuses another account", async ({
  page,
}) => {
  const local = getCsfIsolatedSupabaseEnv();
  const admin = createClient(local.url, local.serviceRoleKey, {
    auth: { persistSession: false },
  });
  const organizationId = randomUUID();
  const invitationId = randomUUID();
  const token = randomUUID();
  const username = `invitation-fixture-${organizationId.slice(0, 8)}`;
  const name = `Fictional invitation ${organizationId.slice(0, 8)}`;
  const path = `/organization/join/invite?token=${token}`;
  const { data: inviter, error: inviterError } = await admin
    .from("profiles")
    .select("id")
    .eq("email", localActors.admin.email)
    .single();
  expect(inviterError).toBeNull();
  if (!inviter)
    throw new Error("Fictional invitation administrator is missing");
  try {
    const { error: orgError } = await admin.from("organizations").insert({
      id: organizationId,
      name,
      username,
      type: "school",
      join_code: fixtureJoinCode(organizationId),
      created_by: inviter.id,
    });
    expect(orgError).toBeNull();
    const { error: ownerError } = await admin
      .from("organization_members")
      .insert({
        organization_id: organizationId,
        user_id: inviter.id,
        role: "admin",
        status: "active",
      });
    expect(ownerError).toBeNull();
    const { error: inviteError } = await admin
      .from("organization_invitations")
      .insert({
        id: invitationId,
        organization_id: organizationId,
        email: localActors.outsider.email,
        role: "staff",
        token,
        invited_by: inviter.id,
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      });
    expect(inviteError).toBeNull();

    await page.goto("/organization/join/invite?token=not-a-token");
    await expect(
      page.getByRole("heading", { name: "Invitation Not Found", exact: true }),
    ).toBeVisible();
    await page.goto(path);
    await expect(
      page.getByText("Invitation Not Found", { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();

    await loginAs(page, "admin", path);
    await page
      .getByRole("button", { name: "Accept Invitation", exact: true })
      .click();
    await expect(
      page.getByText(
        `This invitation was sent to ${localActors.outsider.email}. Please sign in with that email to continue.`,
        { exact: true },
      ),
    ).toBeVisible();
    const before = await admin
      .from("organization_invitations")
      .select("status, accepted_by")
      .eq("id", invitationId)
      .single();
    expect(before.error).toBeNull();
    expect(before.data).toEqual({ status: "pending", accepted_by: null });

    await page.context().clearCookies();
    await loginAs(page, "outsider", path);
    await page
      .getByRole("button", { name: "Accept Invitation", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: `Welcome to ${name}!`, exact: true }),
    ).toBeVisible();
    const accepted = await admin
      .from("organization_invitations")
      .select("status, accepted_by")
      .eq("id", invitationId)
      .single();
    expect(accepted.error).toBeNull();
    expect(accepted.data?.status).toBe("accepted");
    const membership = await admin
      .from("organization_members")
      .select("role, status")
      .eq("organization_id", organizationId)
      .eq("user_id", accepted.data!.accepted_by)
      .single();
    expect(membership.error).toBeNull();
    expect(membership.data).toEqual({ role: "staff", status: "active" });
  } finally {
    const { error } = await admin
      .from("organizations")
      .delete()
      .eq("id", organizationId);
    expect(error, "Remove only the isolated invitation fixture").toBeNull();
  }
});
