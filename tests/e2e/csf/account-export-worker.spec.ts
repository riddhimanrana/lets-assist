import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import JSZip from "jszip";

import {
  getCsfIsolatedSupabaseEnv,
  loadCsfIsolatedAppEnvironment,
} from "../../../scripts/local-dev/dv-local-env.mjs";
import { localTestPassword, loginWithEmail } from "./helpers";

function checked(error: unknown, operation: string) {
  if (error) throw new Error(`Fictional worker export ${operation} failed.`);
}

test("the real account snapshot worker produces a private 48-dataset archive that its owner can download", async ({
  page,
}, testInfo) => {
  const local = getCsfIsolatedSupabaseEnv();
  const admin = createClient(local.url, local.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `export.worker.${randomUUID()}@local.test`;
  const draftId = randomUUID();
  const hiddenAnswer = `fictional-secret-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({
    email,
    password: localTestPassword(),
    email_confirm: true,
    user_metadata: { full_name: "Export worker fixture" },
  });
  checked(created.error, "account creation");
  if (!created.data.user)
    throw new Error("Fictional worker export account missing.");
  const userId = created.data.user.id;
  try {
    checked(
      (
        await admin.from("project_drafts").insert({
          id: draftId,
          user_id: userId,
          title: "Owned worker export fixture",
          draft_data: {
            basicInfo: { title: "Owned worker export fixture" },
            access_token: hiddenAnswer,
          },
        })
      ).error,
      "draft fixture",
    );
    await loginWithEmail(page, email, "/account/security");
    await expect(
      page.getByText("No export requests yet.", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Request data archive", exact: true })
      .click();
    await expect(page.getByText("Queued", { exact: true })).toBeVisible();
    const requested = await admin
      .from("account_data_export_jobs")
      .select("id")
      .eq("user_id", userId)
      .single();
    checked(requested.error, "request readback");
    if (!requested.data)
      throw new Error("Fictional worker export request missing.");

    const ledger = testInfo.outputPath("worker-egress.jsonl");
    mkdirSync(dirname(ledger), { recursive: true, mode: 0o700 });
    writeFileSync(ledger, "", { flag: "wx", mode: 0o600 });
    const appEnvironment = loadCsfIsolatedAppEnvironment(
      process.env.CSF_ISOLATED_WORK_DIR,
    );
    const workerEnvironment: NodeJS.ProcessEnv = {
      ...Object.fromEntries(
        ["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR"].flatMap((key) =>
          process.env[key] ? [[key, process.env[key]!]] : [],
        ),
      ),
      ...appEnvironment,
      NODE_ENV: "test",
      CSF_ISOLATED_APP_PORT: process.env.CSF_ISOLATED_APP_PORT ?? "3000",
      CRON_EGRESS_LEDGER: ledger,
    };
    const worker = spawnSync(
      "bun",
      [
        "--no-env-file",
        "--conditions=react-server",
        resolve("scripts/local-dev/account-export-rehearsal.ts"),
        userId,
        requested.data.id,
      ],
      {
        cwd: process.cwd(),
        env: workerEnvironment,
        encoding: "utf8",
        timeout: 45_000,
        maxBuffer: 1024 * 1024,
      },
    );
    writeFileSync(
      testInfo.outputPath("worker-result.log"),
      `${worker.stdout ?? ""}${worker.stderr ?? ""}`,
      { mode: 0o600 },
    );
    if (worker.error || worker.status !== 0)
      throw new Error(
        "The owned local account export worker rehearsal failed.",
      );
    expect(JSON.parse(worker.stdout)).toMatchObject({
      ready: true,
      delivery: "skipped",
      mailAttempts: 1,
      datasets: 49,
    });
    expect(readFileSync(ledger, "utf8")).toBe("");
    const saved = await admin
      .from("account_data_export_jobs")
      .select(
        "status,delivery_status,artifact_sha256,datasets_count,record_count",
      )
      .eq("id", requested.data.id)
      .eq("user_id", userId)
      .single();
    checked(saved.error, "completion readback");
    expect(saved.data).toMatchObject({
      status: "completed",
      delivery_status: "skipped",
      datasets_count: 49,
    });
    await page
      .getByRole("button", { name: "Refresh status", exact: true })
      .click();
    await expect(page.getByText("Ready", { exact: true })).toBeVisible();
    await expect(
      page.getByText(`Email skipped: ${email}`, { exact: true }),
    ).toBeVisible();
    const downloading = page.waitForEvent("download");
    await page
      .getByRole("button", { name: /^Download export requested / })
      .click();
    const download = await downloading;
    expect(await download.failure()).toBeNull();
    const downloadPath = await download.path();
    if (!downloadPath)
      throw new Error("Fictional worker archive download missing.");
    const bytes = readFileSync(downloadPath);
    expect(
      createHash("sha256").update(bytes).digest("hex") ===
        saved.data!.artifact_sha256,
    ).toBe(true);
    const zip = await JSZip.loadAsync(bytes);
    const manifest = JSON.parse(
      await zip.file("manifest.json")!.async("string"),
    );
    expect(manifest).toMatchObject({
      userId,
      totalDatasets: 49,
      sanitized: true,
      totalRecords: saved.data!.record_count,
    });
    const draftJson = await zip
      .file("profile-data/projectDrafts.json")!
      .async("string");
    const drafts = JSON.parse(draftJson);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      id: draftId,
      title: "Owned worker export fixture",
      draft_data: { access_token: "[REDACTED]" },
    });
    for (const entry of Object.values(zip.files)) {
      if (!entry.dir)
        expect((await entry.async("string")).includes(hiddenAnswer)).toBe(
          false,
        );
    }
  } finally {
    await page.close();
    if (userId) {
      const jobs = await admin
        .from("account_data_export_jobs")
        .select("storage_path")
        .eq("user_id", userId)
        .limit(2);
      checked(jobs.error, "artifact cleanup inventory");
      const paths = (jobs.data ?? [])
        .map(({ storage_path }) => storage_path)
        .filter((path): path is string => typeof path === "string");
      if (paths.length)
        checked(
          (await admin.storage.from("data-exports").remove(paths)).error,
          "artifact cleanup",
        );
      checked(
        (
          await admin
            .from("account_data_export_audit_logs")
            .delete()
            .eq("user_id", userId)
        ).error,
        "audit cleanup",
      );
      checked(
        (
          await admin
            .from("account_data_export_jobs")
            .delete()
            .eq("user_id", userId)
        ).error,
        "job cleanup",
      );
      checked(
        (
          await admin
            .from("project_drafts")
            .delete()
            .eq("id", draftId)
            .eq("user_id", userId)
        ).error,
        "draft cleanup",
      );
      checked(
        (await admin.auth.admin.deleteUser(userId)).error,
        "account cleanup",
      );
    }
  }
});
