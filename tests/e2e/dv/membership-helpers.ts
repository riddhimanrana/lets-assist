import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { getCsfIsolatedSupabaseEnv } from "../../../scripts/local-dev/dv-local-env.mjs";
import { localTestPassword } from "../csf/helpers";

export const organizationId = "d0000000-0000-4000-8000-000000000001";
export const workspacePath =
  "/organization/dv-speech-debate/plugins/dv-speech-debate";
export const memberEmail = "dv.student.b@local.test";

export function localAdmin() {
  const env = getCsfIsolatedSupabaseEnv();
  return createClient(env.url, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function checked<T>(
  operation: PromiseLike<{ data: T; error: unknown }>,
  label: string,
): Promise<NonNullable<T>> {
  const { data, error } = await operation;
  if (error || data == null)
    throw new Error(`Local DV fixture failed: ${label}`);
  return data;
}

export async function mutation(
  operation: PromiseLike<{ error: unknown }>,
  label: string,
) {
  if ((await operation).error)
    throw new Error(`Local DV fixture failed: ${label}`);
}

export async function login(page: Page, email: string) {
  await page.goto(`/login?redirect=${encodeURIComponent(workspacePath)}`);
  const main = page.getByRole("main");
  await expect(main.locator('form[data-hydrated="true"]')).toBeVisible();
  await expect(
    main.getByText("Secure check ready", { exact: true }),
  ).toBeVisible();
  await main.getByRole("textbox", { name: "Email", exact: true }).fill(email);
  await main.getByLabel("Password", { exact: true }).fill(localTestPassword());
  await main.getByRole("button", { name: "Login", exact: true }).click();
  await expect
    .poll(() => new URL(page.url()).pathname, { timeout: 60_000 })
    .toBe(workspacePath);
  await expect(
    page.getByRole("heading", { name: /DV Speech & Debate/ }).first(),
  ).toBeVisible();
}

export async function openRoster(page: Page) {
  await page.getByRole("tab", { name: "Membership", exact: true }).click();
  const roster = page.getByRole("region", {
    name: "Season memberships",
    exact: true,
  });
  await expect(roster).toBeVisible();
  return roster;
}

export async function decide(page: Page, status: string, notes: string) {
  await page
    .getByRole("button", { name: "Review Blair Student", exact: true })
    .click();
  const review = page.getByRole("region", {
    name: "Review membership",
    exact: true,
  });
  await expect(
    review.getByRole("heading", { name: "Saved application answers" }),
  ).toBeVisible();
  await review.getByLabel("Decision", { exact: true }).selectOption(status);
  await review.getByLabel("Notes for the student").fill(notes);
  await review
    .getByRole("button", { name: "Save decision", exact: true })
    .click();
  await expect(review).not.toBeVisible();
}

export const savedAnswers = {
  email: memberEmail,
  schoolEmail: memberEmail,
  studentFirstName: "Blair",
  studentLastName: "Student",
  studentCellPhone: "2025550101",
  personalEmail: "dv.blair.personal@local.test",
  gradeLevel: "11",
  memberStatus: "returning",
  hoodieSize: "M",
  parent1FirstName: "Shared",
  parent1LastName: "Guardian",
  parent1CellPhone: "2025550102",
  parent1Email: "guardian.shared@local.test",
  parent2FirstName: "Shared",
  parent2LastName: "Guardian",
  parent2CellPhone: "2025550102",
  parent2Email: "guardian.shared@local.test",
  membershipPayment: "unpaid",
  memberAgreement: true,
  questionsConcerns: "Saved fictional application answer.",
};

export async function reachLastSection(page: Page) {
  const submit = page.getByRole("button", {
    name: "Resubmit for review",
    exact: true,
  });
  for (let section = 0; section < 8; section++) {
    if (await submit.isVisible()) return submit;
    await page.getByRole("button", { name: "Next", exact: true }).click();
  }
  throw new Error("The membership form exceeded its reviewed section bound.");
}

export async function membershipFixture() {
  const admin = localAdmin();
  const plugin = admin.schema("plugin_data");
  const season = await checked(
    plugin
      .from("org_seasons")
      .select("id,label")
      .eq("organization_id", organizationId)
      .eq("is_current", true)
      .single(),
    "current season",
  );
  const student = await checked(
    plugin
      .from("dv_sd_students")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("school_email", memberEmail)
      .single(),
    "fictional student",
  );
  const membership = await checked(
    plugin
      .from("dv_sd_seasonal_memberships")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("season_id", season.id)
      .eq("student_id", student.id)
      .single(),
    "fictional membership",
  );
  const organizationMember = await checked(
    admin
      .from("organization_members")
      .select("status")
      .eq("organization_id", organizationId)
      .eq("user_id", student.user_id)
      .single(),
    "organization membership",
  );
  const requirements = await checked(
    plugin
      .from("dv_sd_membership_requirements")
      .select("*")
      .eq("membership_id", membership.id),
    "membership requirements",
  );
  const current = () =>
    checked(
      plugin
        .from("dv_sd_seasonal_memberships")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("id", membership.id)
        .single(),
      "membership readback",
    );
  const setMembership = (values: Record<string, unknown>) =>
    mutation(
      plugin
        .from("dv_sd_seasonal_memberships")
        .update(values)
        .eq("organization_id", organizationId)
        .eq("id", membership.id),
      "membership preparation",
    );
  const setAccess = (status: string) =>
    mutation(
      admin
        .from("organization_members")
        .update({ status })
        .eq("organization_id", organizationId)
        .eq("user_id", student.user_id),
      "membership authority",
    );
  const records = async () => {
    const [
      identity,
      household,
      studentLinks,
      guardianLinks,
      guardians,
      receipts,
      audits,
    ] = await Promise.all([
      checked(
        plugin.from("dv_sd_students").select("*").eq("id", student.id).single(),
        "identity readback",
      ),
      checked(
        plugin
          .from("dv_sd_households")
          .select("*")
          .eq("id", membership.household_id)
          .single(),
        "household readback",
      ),
      checked(
        plugin
          .from("dv_sd_household_students")
          .select("*")
          .eq("household_id", membership.household_id)
          .order("student_id"),
        "student links",
      ),
      checked(
        plugin
          .from("dv_sd_household_guardians")
          .select("*")
          .eq("household_id", membership.household_id)
          .order("guardian_id"),
        "guardian links",
      ),
      checked(
        plugin
          .from("dv_sd_guardians")
          .select("*")
          .eq("organization_id", organizationId)
          .order("id"),
        "guardians",
      ),
      checked(
        plugin
          .from("dv_sd_membership_write_receipts")
          .select("request_id,result")
          .eq("membership_id", membership.id)
          .order("request_id"),
        "receipts",
      ),
      checked(
        plugin
          .from("dv_sd_audit_events")
          .select("id,action,metadata")
          .eq("organization_id", organizationId)
          .eq("entity_id", membership.id)
          .order("id"),
        "audits",
      ),
    ]);
    return {
      identity,
      household,
      studentLinks,
      guardianLinks,
      guardians,
      receipts,
      audits,
      membership: await current(),
    };
  };
  return {
    admin,
    plugin,
    student,
    membership,
    season,
    current,
    records,
    setMembership,
    setAccess,
    async prepare(status: "submitted" | "needs_action") {
      await setMembership({
        status,
        application_data: savedAnswers,
        review_notes:
          status === "needs_action" ? "Correct the fictional response." : null,
      });
      await mutation(
        plugin
          .from("dv_sd_membership_requirements")
          .update({ status: "waived" })
          .eq("membership_id", membership.id),
        "reviewable requirements",
      );
    },
    async restore() {
      await setAccess(organizationMember.status);
      await setMembership(membership);
      await mutation(
        plugin
          .from("dv_sd_students")
          .update(student)
          .eq("id", student.id)
          .eq("organization_id", organizationId),
        "identity restore",
      );
      await mutation(
        plugin
          .from("dv_sd_membership_requirements")
          .delete()
          .eq("membership_id", membership.id),
        "requirements restore",
      );
      if (requirements.length)
        await mutation(
          plugin.from("dv_sd_membership_requirements").insert(requirements),
          "requirements reinsertion",
        );
    },
  };
}

export async function rosterFixture() {
  const admin = localAdmin();
  const plugin = admin.schema("plugin_data");
  const seasons = await checked(
    plugin
      .from("org_seasons")
      .select("id,is_current,label")
      .eq("organization_id", organizationId)
      .order("starts_at"),
    "roster seasons",
  );
  const current = seasons.find((season) => season.is_current);
  const previous = seasons.find((season) => !season.is_current);
  if (!current || !previous)
    throw new Error("DV acceptance needs both fictional seasons.");
  const baseline = await checked(
    plugin
      .from("dv_sd_seasonal_memberships")
      .select("id,status")
      .eq("organization_id", organizationId)
      .eq("season_id", current.id),
    "roster baseline",
  );
  const run = randomUUID();
  const prefix = `DV roster ${run.slice(0, 8)}`;
  const householdId = randomUUID();
  const userIds: string[] = [];
  const studentIds: string[] = [];
  const names: string[] = [];
  const cleanup = async () => {
    if (studentIds.length) {
      await mutation(
        plugin
          .from("dv_sd_seasonal_memberships")
          .delete()
          .eq("organization_id", organizationId)
          .in("student_id", studentIds),
        "roster memberships cleanup",
      );
      await mutation(
        plugin
          .from("dv_sd_students")
          .delete()
          .eq("organization_id", organizationId)
          .in("id", studentIds),
        "roster students cleanup",
      );
    }
    await mutation(
      plugin
        .from("dv_sd_households")
        .delete()
        .eq("organization_id", organizationId)
        .eq("id", householdId),
      "roster household cleanup",
    );
    for (const userId of userIds)
      await mutation(
        admin.auth.admin.deleteUser(userId),
        "roster auth cleanup",
      );
  };
  try {
    await mutation(
      plugin.from("dv_sd_households").insert({
        id: householdId,
        organization_id: organizationId,
        display_name: prefix,
      }),
      "roster household",
    );
    for (let index = 0; index < 52; index++) {
      const email = `dv-roster-${run}-${index}@local.test`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: localTestPassword(),
        email_confirm: true,
      });
      if (error || !data.user)
        throw new Error("Local roster account was not created.");
      const user = data.user;
      userIds.push(user.id);
      const id = randomUUID();
      const name =
        index === 51
          ? `${prefix} historical only`
          : `${prefix} ${String(index).padStart(2, "0")}`;
      studentIds.push(id);
      if (index < 51) names.push(name);
      await mutation(
        plugin.from("dv_sd_students").insert({
          id,
          organization_id: organizationId,
          user_id: user.id,
          legal_name: name,
          school_email: email,
        }),
        "roster student",
      );
      const row = {
        organization_id: organizationId,
        student_id: id,
        household_id: householdId,
        application_data: { fixture: run },
        created_at: `2099-01-01T00:00:${String(index).padStart(2, "0")}.000Z`,
      };
      await mutation(
        plugin.from("dv_sd_seasonal_memberships").insert([
          { ...row, season_id: previous.id, status: "approved" },
          ...(index < 51
            ? [
                {
                  ...row,
                  season_id: current.id,
                  status: "submitted",
                },
              ]
            : []),
        ]),
        "two-season memberships",
      );
    }
    return { prefix, names, current, previous, baseline, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
