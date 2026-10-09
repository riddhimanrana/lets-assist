import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import JSZip from "jszip";

import { getCsfIsolatedSupabaseEnv } from "../../../scripts/local-dev/dv-local-env.mjs";
import { localTestPassword, loginWithEmail } from "./helpers";

function checked(error: unknown, operation: string) {
  if (error) throw new Error(`Fictional export ${operation} failed.`);
}

test("account export requests, private downloads, ownership, and expiry use the real server boundary", async ({
  page,
  browser,
}) => {
  const local = getCsfIsolatedSupabaseEnv();
  const admin = createClient(local.url, local.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const users: Array<{ id: string; email: string }> = [];
  const paths: string[] = [];
  const otherContext = await browser.newContext();
  let jobId: string | undefined;
  try {
    // The claim RPC owns a bounded queue, so refuse another test's active job.
    const queue = await admin
      .from("account_data_export_jobs")
      .select("id", { count: "exact", head: true })
      .or(
        "status.in.(pending,processing),and(status.eq.completed,delivery_status.eq.not_attempted)",
      );
    checked(queue.error, "queue inspection");
    expect(queue.count).toBe(0);
    for (const role of ["owner", "other"]) {
      const email = `export.${role}.${randomUUID()}@local.test`;
      const created = await admin.auth.admin.createUser({
        email,
        password: localTestPassword(),
        email_confirm: true,
        user_metadata: { full_name: `Export ${role} fixture` },
      });
      checked(created.error, "account creation");
      if (!created.data.user)
        throw new Error("Fictional export account missing.");
      users.push({ id: created.data.user.id, email });
    }
    const [owner, other] = users;
    await loginWithEmail(page, owner.email, "/account/security");
    await expect(
      page.getByRole("heading", { name: "Export your data" }),
    ).toBeVisible();
    await expect(
      page.getByText("No export requests yet.", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Request data archive", exact: true })
      .click();
    await expect(page.getByText("Queued", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Export already queued" }),
    ).toBeDisabled();
    const requested = await admin
      .from("account_data_export_jobs")
      .select("id,user_id,protocol_version,status,delivery_status")
      .eq("user_id", owner.id)
      .single();
    checked(requested.error, "request readback");
    expect(requested.data).toMatchObject({
      user_id: owner.id,
      protocol_version: 2,
      status: "pending",
      delivery_status: "not_attempted",
    });
    jobId = requested.data!.id;
    const claimed = await admin.rpc("claim_account_data_export_jobs", {
      p_limit: 1,
    });
    checked(claimed.error, "claim");
    expect(claimed.data).toHaveLength(1);
    expect(claimed.data[0]).toMatchObject({
      id: jobId,
      user_id: owner.id,
      status: "processing",
    });
    const lease = claimed.data[0].lease_token as string;

    // This is a synthetic archive, not worker or complete dataset coverage.
    // Its lease, object upload, readiness receipt, and signed download are real.
    const zip = new JSZip();
    zip.file(
      "manifest.json",
      JSON.stringify({ acceptanceFixture: true, userId: owner.id }),
    );
    zip.file(
      "fixture.json",
      JSON.stringify({ description: "Owned fictional account archive" }),
    );
    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    const digest = createHash("sha256").update(bytes).digest("hex");
    async function advance(step: string, data: Record<string, unknown> = {}) {
      const result = await admin.rpc("advance_account_data_export", {
        p_job_id: jobId,
        p_lease: lease,
        p_step: step,
        p_data: data,
      });
      checked(result.error, step);
      return result.data;
    }
    const planned = await advance("plan_artifact", {
      sha256: digest,
      size_bytes: bytes.length,
      record_count: 1,
      datasets_count: 1,
      manifest: { totalDatasets: 1, acceptanceFixture: true },
    });
    const storagePath = `${owner.id}/${jobId}/${lease}.zip`;
    expect(planned.storage_path === storagePath).toBe(true);
    paths.push(storagePath);
    const uploaded = await admin.storage
      .from("data-exports")
      .upload(storagePath, bytes, {
        contentType: "application/zip",
        upsert: false,
      });
    checked(uploaded.error, "private upload");
    await advance("archive_ready");
    await page
      .getByRole("button", { name: "Refresh status", exact: true })
      .click();
    await expect(page.getByText("Ready", { exact: true })).toBeVisible();
    await expect(
      page.getByText(`Email not attempted: ${owner.email}`, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Email accepted for delivery", { exact: false }),
    ).toHaveCount(0);

    const unsigned = await page.request.get(
      `${local.url}/storage/v1/object/public/data-exports/${storagePath}`,
    );
    expect(unsigned.ok()).toBe(false);
    const downloadAction = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        Boolean(request.headers()["next-action"]) &&
        (request.postData() ?? "").includes(jobId!),
    );
    const downloadEvent = page.waitForEvent("download");
    await page
      .getByRole("button", { name: /^Download export requested / })
      .click();
    const [actionRequest, download] = await Promise.all([
      downloadAction,
      downloadEvent,
    ]);
    expect(download.suggestedFilename()).toBe("lets-assist-account-data.zip");
    expect(await download.failure()).toBeNull();
    const downloadedPath = await download.path();
    if (!downloadedPath) throw new Error("Fictional archive download missing.");
    const downloaded = await readFile(downloadedPath);
    expect(
      createHash("sha256").update(downloaded).digest("hex") === digest,
    ).toBe(true);
    const archive = await JSZip.loadAsync(downloaded);
    expect(
      JSON.parse(await archive.file("manifest.json")!.async("string")),
    ).toEqual({
      acceptanceFixture: true,
      userId: owner.id,
    });

    // Replay the observed server action with a different authenticated session.
    // The action ID and body stay in memory and never enter an artifact.
    const actionHeaders = {
      "next-action": actionRequest.headers()["next-action"],
      "content-type": actionRequest.headers()["content-type"],
    };
    const actionBody = actionRequest.postData();
    if (!actionBody) throw new Error("Export download action body missing.");
    const otherPage = await otherContext.newPage();
    await loginWithEmail(otherPage, other.email, "/account/security");
    await expect(
      otherPage.getByText("No export requests yet.", { exact: true }),
    ).toBeVisible();
    const foreign = await otherPage.request.post(actionRequest.url(), {
      headers: actionHeaders,
      data: actionBody,
    });
    const foreignBody = await foreign.text();
    expect(
      foreignBody.includes(
        "This export is unavailable, has expired, or could not be verified.",
      ),
    ).toBe(true);
    expect(foreignBody.includes("/storage/v1/object/sign/")).toBe(false);

    checked(
      (
        await admin
          .from("account_data_export_jobs")
          .update({
            artifact_expires_at: new Date(Date.now() - 60_000).toISOString(),
          })
          .eq("id", jobId)
          .eq("user_id", owner.id)
      ).error,
      "expiry fixture",
    );
    const expired = await page.request.post(actionRequest.url(), {
      headers: actionHeaders,
      data: actionBody,
    });
    const expiredBody = await expired.text();
    expect(
      expiredBody.includes(
        "This export is unavailable, has expired, or could not be verified.",
      ),
    ).toBe(true);
    expect(expiredBody.includes("/storage/v1/object/sign/")).toBe(false);
    await page
      .getByRole("button", { name: "Refresh status", exact: true })
      .click();
    await expect(page.getByText("Expired", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Download export requested / }),
    ).toHaveCount(0);
  } finally {
    await page.close();
    await otherContext.close();
    await cleanup(
      admin,
      users.map(({ id }) => id),
      paths,
    );
  }
});

async function cleanup(
  admin: SupabaseClient,
  userIds: string[],
  paths: string[],
) {
  if (paths.length)
    checked(
      (await admin.storage.from("data-exports").remove(paths)).error,
      "object cleanup",
    );
  for (const id of userIds) {
    checked(
      (
        await admin
          .from("account_data_export_audit_logs")
          .delete()
          .eq("user_id", id)
      ).error,
      "audit cleanup",
    );
    checked(
      (await admin.from("account_data_export_jobs").delete().eq("user_id", id))
        .error,
      "job cleanup",
    );
    checked((await admin.auth.admin.deleteUser(id)).error, "account cleanup");
  }
}
