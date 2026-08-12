import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getCsfIsolatedSupabaseEnv } from "../../../scripts/local-dev/dv-local-env.mjs";
import {
  expectNoBrowserFailures,
  watchBrowserFailures,
  loginAs,
} from "./helpers";

/**
 * Visible acceptance for the two identity P0s.
 *
 * CLEAN-006: a merge preview must never offer a consequential merge while the
 * identity evidence conflicts. CLEAN-013: officer resolution must never offer a
 * one-click connect to a same-named classmate without corroboration.
 *
 * Both journeys use their own synthetic records so they assert a state they
 * created rather than whatever the shared seed happens to contain. The pairs
 * deliberately share one graduating class: after the cohort-consolidation
 * migration that overlap is no longer a blocker, so anything still blocking is
 * identity evidence and nothing else.
 */

type IdentityFixture = {
  admin: SupabaseClient;
  organizationId: string;
  cohortId: string;
  suffix: string;
  mergeSourceId: string;
  mergeTargetId: string;
  mergeSourceName: string;
  mergeTargetName: string;
  classmateIds: string[];
  classmateName: string;
  requestId: string;
  requestUserId?: string;
  requestEmail: string;
};

let fixture: IdentityFixture;

function assertNoSupabaseError(
  operation: string,
  error: { message: string } | null,
) {
  if (error) throw new Error(`${operation}: ${error.message}`);
}

async function seedIdentityFixture(): Promise<IdentityFixture> {
  const local = getCsfIsolatedSupabaseEnv();
  const admin = createClient(local.url, local.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const plugin = admin.schema("plugin_data");

  const { data: organization, error: organizationError } = await admin
    .from("organizations")
    .select("id")
    .eq("username", "dvhs-csf")
    .single();
  if (organizationError || !organization) {
    throw new Error(
      `Could not load the local DVHS CSF organization: ${organizationError?.message ?? "missing fixture"}`,
    );
  }

  const { data: cohort, error: cohortError } = await plugin
    .from("csf_cohorts")
    .select("id")
    .eq("organization_id", organization.id)
    .eq("graduation_year", 2028)
    .single();
  if (cohortError || !cohort) {
    throw new Error(
      `Could not load the Class of 2028 fixture: ${cohortError?.message ?? "missing fixture"}`,
    );
  }

  // A per-run suffix keeps every synthetic name, address, and row unique, so a
  // retry can never collide with a previous run's leftovers.
  const suffix = randomUUID().slice(0, 8);
  const mergeSourceId = randomUUID();
  const mergeTargetId = randomUUID();
  const classmateIds = [randomUUID(), randomUUID()];
  const requestId = randomUUID();
  const mergeSourceName = `Wren Halloway-${suffix}`;
  const mergeTargetName = `Wren Halloway-${suffix}`;
  const classmateName = `Marlowe Ashby-${suffix}`;
  const requestEmail = `identity.safety.${suffix}@local.test`;

  const provisional: IdentityFixture = {
    admin,
    organizationId: organization.id,
    cohortId: cohort.id,
    suffix,
    mergeSourceId,
    mergeTargetId,
    mergeSourceName,
    mergeTargetName,
    classmateIds,
    classmateName,
    requestId,
    requestEmail,
  };

  try {
    // Merge pair: one student name, two different school identities. The shared
    // class is consolidatable, so the only remaining blockers are identity.
    const { error: mergeProfilesError } = await plugin
      .from("csf_profiles")
      .insert([
        {
          id: mergeSourceId,
          organization_id: organization.id,
          first_name: "Wren",
          last_name: `Halloway-${suffix}`,
          school_email: `wren.alpha.${suffix}@students.local.test`,
          normalized_first_name: "wren",
          normalized_last_name: `halloway-${suffix}`,
          normalized_school_email: `wren.alpha.${suffix}@students.local.test`,
          source_summary: { browserFixture: true },
        },
        {
          id: mergeTargetId,
          organization_id: organization.id,
          first_name: "Wren",
          last_name: `Halloway-${suffix}`,
          school_email: `wren.beta.${suffix}@students.local.test`,
          normalized_first_name: "wren",
          normalized_last_name: `halloway-${suffix}`,
          normalized_school_email: `wren.beta.${suffix}@students.local.test`,
          source_summary: { browserFixture: true },
        },
      ]);
    assertNoSupabaseError(
      "Could not seed the merge fixture",
      mergeProfilesError,
    );

    // Connection pair: two genuine classmates who share a name exactly. Neither
    // carries the requesting account's confirmed address.
    const { error: classmateError } = await plugin.from("csf_profiles").insert([
      {
        id: classmateIds[0],
        organization_id: organization.id,
        first_name: "Marlowe",
        last_name: `Ashby-${suffix}`,
        school_email: `marlowe.one.${suffix}@students.local.test`,
        normalized_first_name: "marlowe",
        normalized_last_name: `ashby-${suffix}`,
        normalized_school_email: `marlowe.one.${suffix}@students.local.test`,
        source_summary: { browserFixture: true },
      },
      {
        id: classmateIds[1],
        organization_id: organization.id,
        first_name: "Marlowe",
        last_name: `Ashby-${suffix}`,
        school_email: `marlowe.two.${suffix}@students.local.test`,
        normalized_first_name: "marlowe",
        normalized_last_name: `ashby-${suffix}`,
        normalized_school_email: `marlowe.two.${suffix}@students.local.test`,
        source_summary: { browserFixture: true },
      },
    ]);
    assertNoSupabaseError(
      "Could not seed the classmate fixture",
      classmateError,
    );

    const { error: membershipError } = await plugin
      .from("csf_profile_cohort_memberships")
      .insert(
        [mergeSourceId, mergeTargetId, ...classmateIds].map((profileId) => ({
          organization_id: organization.id,
          profile_id: profileId,
          cohort_id: cohort.id,
          status: "active",
        })),
      );
    assertNoSupabaseError(
      "Could not seed the class memberships",
      membershipError,
    );

    const { data: created, error: userError } =
      await admin.auth.admin.createUser({
        email: requestEmail,
        password: randomUUID(),
        email_confirm: true,
      });
    if (userError || !created?.user) {
      throw new Error(
        `Could not create the synthetic requesting account: ${userError?.message ?? "missing user"}`,
      );
    }
    provisional.requestUserId = created.user.id;

    const { error: requestError } = await plugin
      .from("csf_profile_link_requests")
      .insert({
        id: requestId,
        organization_id: organization.id,
        cohort_id: cohort.id,
        user_id: created.user.id,
        signed_in_email: requestEmail,
        first_name: "Marlowe",
        last_name: `Ashby-${suffix}`,
        normalized_first_name: "marlowe",
        normalized_last_name: `ashby-${suffix}`,
        candidate_profile_ids: classmateIds,
        match_status: "needs_review",
      });
    assertNoSupabaseError(
      "Could not seed the connection request",
      requestError,
    );

    return provisional;
  } catch (seedError) {
    try {
      await cleanIdentityFixture(provisional);
    } catch (cleanupError) {
      throw new AggregateError(
        [seedError, cleanupError],
        "Identity fixture seeding and recovery cleanup both failed",
      );
    }
    throw seedError;
  }
}

async function cleanIdentityFixture(current: IdentityFixture) {
  const plugin = current.admin.schema("plugin_data");

  // Order matters. The request row is removed before its account, and every
  // profile is removed before the auth user, so nothing is left referencing a
  // row that is already gone. Immutable audit rows reference the request by a
  // bare identifier and the actor by an ON DELETE SET NULL key, so none of this
  // rewrites or deletes audit history.
  const { error: requestError } = await plugin
    .from("csf_profile_link_requests")
    .delete()
    .eq("organization_id", current.organizationId)
    .eq("id", current.requestId);
  assertNoSupabaseError("Could not clean the connection request", requestError);

  if (current.requestUserId) {
    const { error: accountError } = await plugin
      .from("csf_profile_accounts")
      .delete()
      .eq("organization_id", current.organizationId)
      .eq("user_id", current.requestUserId);
    assertNoSupabaseError("Could not clean the profile account", accountError);
  }

  const { error: membershipError } = await plugin
    .from("csf_profile_cohort_memberships")
    .delete()
    .eq("organization_id", current.organizationId)
    .in("profile_id", [
      current.mergeSourceId,
      current.mergeTargetId,
      ...current.classmateIds,
    ]);
  assertNoSupabaseError("Could not clean cohort memberships", membershipError);

  const { error: profileError } = await plugin
    .from("csf_profiles")
    .delete()
    .eq("organization_id", current.organizationId)
    .in("id", [
      current.mergeSourceId,
      current.mergeTargetId,
      ...current.classmateIds,
    ]);
  assertNoSupabaseError("Could not clean synthetic profiles", profileError);

  if (current.requestUserId) {
    const { error: authError } = await current.admin.auth.admin.deleteUser(
      current.requestUserId,
    );
    assertNoSupabaseError("Could not clean the auth user", authError);
  }
}

async function openMembersTab(page: Page) {
  await page.getByRole("tab", { name: "Members", exact: true }).click();
  await expect(page).toHaveURL(/[?&]tab=csf-members(?:&|$)/);
  await expect(
    page.getByRole("navigation", { name: "Member views" }),
  ).toBeVisible();
}

test.describe("CSF identity safety", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    fixture = await seedIdentityFixture();
  });

  test.afterAll(async () => {
    if (fixture) await cleanIdentityFixture(fixture);
  });

  test("a merge with conflicting identity evidence is previewed and refused", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await loginAs(page, "admin");
    await openMembersTab(page);

    const search = page.getByLabel("Search members");
    await search.fill(`Halloway-${fixture.suffix}`);
    await search.press("Enter");
    await expect(
      page.getByText(fixture.mergeSourceName, { exact: false }).first(),
    ).toBeVisible();
    // The directory search is server-backed. Wait for its final result summary
    // before opening the portaled row menu so a late roster refresh cannot
    // close the menu between the trigger click and the correction action.
    await expect(
      page.getByText("Showing 2 of 2 matching members."),
    ).toBeVisible();

    const sourceRow = page.getByRole("row").filter({
      hasText: `wren.alpha.${fixture.suffix}@students.local.test`,
    });
    await expect(sourceRow).toBeVisible();
    await sourceRow
      .getByRole("button", { name: `Actions for ${fixture.mergeSourceName}` })
      .click();
    await page
      .getByRole("menuitem", { name: "Merge duplicate record" })
      .click();

    const dialog = page.getByRole("dialog", {
      name: "Merge a duplicate student record",
    });
    await expect(dialog).toBeVisible();

    await dialog
      .getByRole("combobox", { name: "Canonical record to keep" })
      .click();
    await page
      .getByRole("option", { name: new RegExp(`Halloway-${fixture.suffix}`) })
      .first()
      .click();
    await dialog.getByRole("button", { name: "Preview merge" }).click();

    // The exact server verdict, not a client guess.
    const blockerAlert = dialog.getByRole("alert").filter({
      hasText: "Resolve 2 blockers first",
    });
    await expect(blockerAlert).toBeVisible();
    await expect(
      blockerAlert.getByText(
        "The records do not share an exact verified school or personal email.",
      ),
    ).toBeVisible();
    await expect(
      blockerAlert.getByText(
        "The records contain different school email identities.",
      ),
    ).toBeVisible();

    // The shared graduating class is consolidatable and must NOT be a blocker.
    await expect(
      dialog.getByText("Both records belong to the same graduating class."),
    ).toHaveCount(0);

    const evidence = dialog.getByRole("list", {
      name: "Merge identity evidence",
    });
    await expect(evidence).toBeVisible();
    await expect(
      evidence.getByText(
        "No exact school or personal email is shared by both records.",
      ),
    ).toBeVisible();
    await expect(
      evidence.getByText(
        "The records contain different school email identities.",
      ),
    ).toBeVisible();

    await expect(dialog.getByText("Ready to merge")).toHaveCount(0);
    await expect(dialog.getByLabel("Reason for merge")).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: "Merge into canonical record" }),
    ).toBeDisabled();

    // Nothing consequential may have happened.
    const plugin = fixture.admin.schema("plugin_data");
    const { data: reviews, error: reviewsError } = await plugin
      .from("csf_profile_merge_reviews")
      .select("id")
      .eq("organization_id", fixture.organizationId)
      .eq("source_profile_id", fixture.mergeSourceId);
    assertNoSupabaseError("Could not verify merge reviews", reviewsError);
    expect(reviews ?? []).toEqual([]);

    const { data: audits, error: auditsError } = await plugin
      .from("csf_admin_audit_events")
      .select("id")
      .eq("organization_id", fixture.organizationId)
      .eq("action", "profile.merge")
      .eq("target_id", fixture.mergeTargetId);
    assertNoSupabaseError("Could not verify merge audit events", auditsError);
    expect(audits ?? []).toEqual([]);

    const { data: sourceProfile, error: sourceProfileError } = await plugin
      .from("csf_profiles")
      .select("record_status")
      .eq("id", fixture.mergeSourceId)
      .single();
    assertNoSupabaseError(
      "Could not verify the source profile",
      sourceProfileError,
    );
    expect(sourceProfile?.record_status).toBe("active");

    expectNoBrowserFailures(failures);
  });

  test("a same-named classmate cannot be connected without corroboration", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await loginAs(page, "admin");
    await openMembersTab(page);

    await page.getByRole("button", { name: "Account connections" }).click();
    await expect(page).toHaveURL(/[?&]csf_member_view=connections(?:&|$)/);

    const connections = page.getByRole("region", {
      name: "Account connections",
    });
    await expect(connections).toBeVisible();
    await expect(
      connections.getByText(fixture.classmateName, { exact: false }).first(),
    ).toBeVisible();

    // Ranking is advisory and must say so on the surface.
    await expect(connections.getByText("Review only").first()).toBeVisible();
    await expect(connections.getByText("Canonical evidence ready")).toHaveCount(
      0,
    );

    const unsafeClassmateReviews = connections.getByRole("button", {
      name: `Review in Resolve ${fixture.classmateName}`,
    });
    // The fixture deliberately creates two distinct classmates with the exact
    // same name and equally insufficient evidence. Either candidate must fail
    // closed; choose the first visible suggestion explicitly instead of making
    // the locator pretend the accessible names are unique.
    await expect(unsafeClassmateReviews).toHaveCount(2);
    await unsafeClassmateReviews.first().click();

    const dialog = page.getByRole("dialog", {
      name: "Review account connection",
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Connection unavailable")).toBeVisible();
    await expect(
      dialog.getByText(
        "The account's confirmed email does not match this student record.",
      ),
    ).toBeVisible();

    // The one-click connect is not merely disabled: it is not offered at all.
    await expect(
      dialog.getByRole("button", { name: "Connect account" }),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: "Reject request" }),
    ).toBeVisible();

    await dialog
      .getByLabel("Decision reason")
      .fill("No corroborating confirmed email; inviting the student directly.");
    await dialog.getByRole("button", { name: "Reject request" }).click();

    await expect
      .poll(async () => {
        const { data, error } = await fixture.admin
          .schema("plugin_data")
          .from("csf_profile_link_requests")
          .select("match_status")
          .eq("id", fixture.requestId)
          .single();
        assertNoSupabaseError("Could not poll the connection request", error);
        return data?.match_status ?? null;
      })
      .toBe("rejected");

    const requestUserId = fixture.requestUserId;
    if (!requestUserId) {
      throw new Error("The seeded connection request has no auth user");
    }
    const { data: accounts, error: accountsError } = await fixture.admin
      .schema("plugin_data")
      .from("csf_profile_accounts")
      .select("id")
      .eq("organization_id", fixture.organizationId)
      .eq("user_id", requestUserId);
    assertNoSupabaseError("Could not verify profile accounts", accountsError);
    expect(accounts ?? []).toEqual([]);

    expectNoBrowserFailures(failures);
  });
});
