import { execFileSync } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  getCsfIsolatedSupabaseEnv,
  inspectCsfIsolatedWorkDir,
} from "../../../scripts/local-dev/dv-local-env.mjs";
import { localTestPassword, loginWithEmail } from "./helpers";

type Account = { id: string; email: string };
type StoredObject = { bucket: "avatars" | "data-exports"; path: string };
type DeletionReceipt = {
  phase: string;
  mode: string;
  blockers: Record<string, unknown>;
  safe_error_code: string | null;
  deleted_counts: Record<string, number>;
  completed: boolean;
  object_count: number;
  pending_object_count: number;
};

function checked(error: unknown, operation: string) {
  if (error) throw new Error(`Fictional deletion ${operation} failed.`);
}

function fixtureSql(accountId: string, cleanup = false) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      accountId,
    )
  )
    throw new Error("Invalid fictional account identifier.");
  getCsfIsolatedSupabaseEnv();
  const isolated = inspectCsfIsolatedWorkDir(process.env.CSF_ISOLATED_WORK_DIR);
  // These receipts deny direct service-role reads. Use the validated local
  // owner connection for fixture readback and account-scoped fixture teardown.
  const query = cleanup
    ? `DELETE FROM app_private.account_deletion_operations WHERE target_user_id='${accountId}';`
    : `SELECT coalesce(json_agg(row_to_json(receipt)), '[]'::json) FROM (
        SELECT phase, mode, blockers, safe_error_code, deleted_counts,
          completed_at IS NOT NULL AS completed,
          (SELECT count(*) FROM app_private.account_deletion_storage_objects o
            WHERE o.operation_id=operation.id) AS object_count,
          (SELECT count(*) FROM app_private.account_deletion_storage_objects o
            WHERE o.operation_id=operation.id AND o.deleted_at IS NULL) AS pending_object_count
        FROM app_private.account_deletion_operations operation
        WHERE target_user_id='${accountId}'
      ) receipt;`;
  try {
    return execFileSync(
      "docker",
      [
        "exec",
        "-i",
        `supabase_db_${isolated.projectId}`,
        "psql",
        "-X",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-t",
        "-A",
      ],
      {
        input: `SET statement_timeout='5s';\n${query}`,
        encoding: "utf8",
        timeout: 10_000,
        stdio: ["pipe", "pipe", "pipe"],
      },
    )
      .replace(/^SET\s*/u, "")
      .trim();
  } catch {
    throw new Error("Fictional deletion receipt query failed.");
  }
}

function receiptFor(accountId: string): DeletionReceipt {
  const rows = JSON.parse(fixtureSql(accountId)) as DeletionReceipt[];
  expect(rows).toHaveLength(1);
  return rows[0];
}

async function newAccount(admin: SupabaseClient, accounts: Account[]) {
  const email = `deletion.${randomUUID()}@local.test`;
  const created = await admin.auth.admin.createUser({
    email,
    password: localTestPassword(),
    email_confirm: true,
    user_metadata: { full_name: "Account deletion fixture" },
  });
  checked(created.error, "account creation");
  if (!created.data.user)
    throw new Error("Fictional deletion account missing.");
  const account = { id: created.data.user.id, email };
  accounts.push(account);
  return account;
}

async function uploadPersonalObjects(
  admin: SupabaseClient,
  account: Account,
  objects: StoredObject[],
) {
  const planned: Array<StoredObject & { bytes: Buffer; contentType: string }> =
    [
      {
        bucket: "avatars",
        path: `${account.id}-${randomUUID()}.png`,
        bytes: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
          "base64",
        ),
        contentType: "image/png",
      },
      {
        bucket: "data-exports",
        path: `${account.id}/browser-fixture/${randomUUID()}.zip`,
        bytes: Buffer.from(
          "504b05060000000000000000000000000000000000000000",
          "hex",
        ),
        contentType: "application/zip",
      },
    ];
  for (const object of planned) {
    objects.push({ bucket: object.bucket, path: object.path });
    checked(
      (
        await admin.storage
          .from(object.bucket)
          .upload(object.path, object.bytes, {
            contentType: object.contentType,
            upsert: false,
          })
      ).error,
      "personal object upload",
    );
  }
}

async function expectObjectsPresent(
  admin: SupabaseClient,
  objects: StoredObject[],
) {
  for (const object of objects) {
    const readback = await admin.storage
      .from(object.bucket)
      .download(object.path);
    checked(readback.error, "personal object readback");
    expect(readback.data?.size).toBeGreaterThan(0);
  }
}

async function confirmDeletion(page: Page) {
  await page
    .getByRole("button", { name: "Delete Account", exact: true })
    .click();
  const dialog = page.getByRole("alertdialog");
  const submit = dialog.getByRole("button", {
    name: "Delete Account",
    exact: true,
  });
  await expect(submit).toBeDisabled();
  await dialog.getByRole("textbox").fill("delete my account");
  await expect(submit).toBeEnabled();
  await submit.click();
}

async function cleanupFixtures(
  admin: SupabaseClient,
  accounts: Account[],
  objects: StoredObject[],
  auditIds: string[] = [],
) {
  for (const object of objects) {
    checked(
      (await admin.storage.from(object.bucket).remove([object.path])).error,
      "object cleanup",
    );
  }
  if (auditIds.length) {
    checked(
      (
        await admin
          .from("account_data_export_audit_logs")
          .delete()
          .in("id", auditIds)
      ).error,
      "export audit cleanup",
    );
  }
  for (const account of accounts) {
    checked(
      (
        await admin
          .from("account_data_export_jobs")
          .delete()
          .eq("user_id", account.id)
      ).error,
      "export cleanup",
    );
    const deleted = await admin.auth.admin.deleteUser(account.id);
    if (deleted.error?.code !== "user_not_found")
      checked(deleted.error, "account cleanup");
    fixtureSql(account.id, true);
  }
}

test("settings deletion removes owned Storage, personal rows, and Auth before reporting completion", async ({
  page,
}) => {
  const local = getCsfIsolatedSupabaseEnv();
  const admin = createClient(local.url, local.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const accounts: Account[] = [];
  const objects: StoredObject[] = [];
  const auditIds: string[] = [];
  try {
    const account = await newAccount(admin, accounts);
    const unrelated = await newAccount(admin, accounts);
    await uploadPersonalObjects(admin, account, objects);
    await expectObjectsPresent(admin, objects);
    checked(
      (
        await admin.rpc("request_account_data_export", {
          p_user_id: account.id,
        })
      ).error,
      "pending export fixture",
    );
    const queued = await admin
      .from("account_data_export_jobs")
      .select("id,status")
      .eq("user_id", account.id);
    checked(queued.error, "pending export readback");
    expect(queued.data).toHaveLength(1);
    expect(queued.data![0].status).toBe("pending");
    const audit = await admin
      .from("account_data_export_audit_logs")
      .select("id")
      .eq("user_id", account.id);
    checked(audit.error, "export audit fixture readback");
    auditIds.push(...(audit.data ?? []).map((row) => row.id as string));
    expect(auditIds).toHaveLength(1);

    await loginWithEmail(page, account.email, "/account/security");
    await confirmDeletion(page);
    await page.waitForURL(
      (url) =>
        url.pathname === "/" && url.searchParams.get("deleted") === "true",
      { timeout: 30_000 },
    );
    const auth = await admin.auth.admin.getUserById(account.id);
    expect(auth.data.user).toBeNull();
    expect(auth.error?.code).toBe("user_not_found");
    const profile = await admin
      .from("profiles")
      .select("id")
      .eq("id", account.id);
    checked(profile.error, "removed profile readback");
    expect(profile.data).toEqual([]);
    const jobs = await admin
      .from("account_data_export_jobs")
      .select("id")
      .eq("user_id", account.id);
    checked(jobs.error, "removed export readback");
    expect(jobs.data).toEqual([]);
    for (const object of objects) {
      const readback = await admin.storage
        .from(object.bucket)
        .download(object.path);
      expect(readback.data).toBeNull();
      expect(readback.error).not.toBeNull();
      const slash = object.path.lastIndexOf("/");
      const folder = slash < 0 ? "" : object.path.slice(0, slash);
      const name = object.path.slice(slash + 1);
      const listed = await admin.storage
        .from(object.bucket)
        .list(folder, { search: name });
      checked(listed.error, "removed object catalog readback");
      expect(listed.data?.some((entry) => entry.name === name)).toBe(false);
    }
    expect(receiptFor(account.id)).toMatchObject({
      phase: "completed",
      mode: "self_delete",
      blockers: {},
      safe_error_code: null,
      completed: true,
      object_count: 2,
      pending_object_count: 0,
      deleted_counts: { profiles: 1, account_data_export_jobs: 1 },
    });
    const otherAuth = await admin.auth.admin.getUserById(unrelated.id);
    checked(otherAuth.error, "unrelated account readback");
    expect(otherAuth.data.user?.id).toBe(unrelated.id);
    await page.goto("/account/security");
    await expect(page).toHaveURL(/\/login(?:\?|$)/u);
  } finally {
    await page.close();
    await cleanupFixtures(admin, accounts, objects, auditIds);
  }
});

test("settings deletion refuses retained plugin evidence without removing account data", async ({
  page,
}) => {
  const local = getCsfIsolatedSupabaseEnv();
  const admin = createClient(local.url, local.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const accounts: Account[] = [];
  const objects: StoredObject[] = [];
  const organizationId = randomUUID();
  const memberProfileId = randomUUID();
  try {
    const account = await newAccount(admin, accounts);
    await uploadPersonalObjects(admin, account, objects);
    checked(
      (
        await admin.from("organizations").insert({
          id: organizationId,
          name: "Deletion retention fixture",
          username: `del-${organizationId.slice(0, 12)}`,
          type: "school",
          join_code: String(randomInt(100000, 1000000)),
        })
      ).error,
      "organization fixture",
    );
    checked(
      (
        await admin
          .schema("plugin_data")
          .from("org_member_profiles")
          .insert({
            id: memberProfileId,
            organization_id: organizationId,
            user_id: account.id,
            plugin_key: "dvhs-csf",
            profile_data: { acceptanceFixture: true },
          })
      ).error,
      "retained plugin fixture",
    );
    const preview = await admin.rpc("preflight_account_deletion", {
      p_actor: account.id,
      p_target: account.id,
    });
    checked(preview.error, "retention preflight");
    expect(preview.data).toEqual({ plugin_retention_review_required: true });

    await loginWithEmail(page, account.email, "/account/security");
    await confirmDeletion(page);
    await expect(
      page.getByText("Account removal is blocked.", { exact: false }).first(),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/account\/security$/u);
    const auth = await admin.auth.admin.getUserById(account.id);
    checked(auth.error, "retained account readback");
    expect(auth.data.user?.id).toBe(account.id);
    const profile = await admin
      .from("profiles")
      .select("id")
      .eq("id", account.id)
      .single();
    checked(profile.error, "retained profile readback");
    expect(profile.data?.id).toBe(account.id);
    const evidence = await admin
      .schema("plugin_data")
      .from("org_member_profiles")
      .select("id,user_id,organization_id,profile_data")
      .eq("id", memberProfileId)
      .single();
    checked(evidence.error, "retained plugin readback");
    expect(evidence.data).toEqual({
      id: memberProfileId,
      user_id: account.id,
      organization_id: organizationId,
      profile_data: { acceptanceFixture: true },
    });
    await expectObjectsPresent(admin, objects);
    expect(receiptFor(account.id)).toMatchObject({
      phase: "blocked",
      mode: "self_delete",
      safe_error_code: null,
      blockers: { plugin_retention_review_required: true },
      deleted_counts: {},
      completed: false,
      object_count: 0,
      pending_object_count: 0,
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("button", { name: "Delete Account", exact: true }),
    ).toBeVisible();
  } finally {
    await page.close();
    checked(
      (
        await admin
          .schema("plugin_data")
          .from("org_member_profiles")
          .delete()
          .eq("id", memberProfileId)
          .eq("organization_id", organizationId)
      ).error,
      "retained fixture cleanup",
    );
    checked(
      (await admin.from("organizations").delete().eq("id", organizationId))
        .error,
      "organization cleanup",
    );
    await cleanupFixtures(admin, accounts, objects);
  }
});
