import "server-only";

import { getAdminClient } from "@/lib/supabase/admin";

const workerEnv = {
  workbook_refresh: "CSF_WORKBOOK_WORKER_ENABLED",
  import_commit: "CSF_IMPORT_WORKER_ENABLED",
  communications: "CSF_COMMUNICATIONS_WORKER_ENABLED",
  scheduled_post_publisher: "CSF_SCHEDULED_POST_PUBLISHER_ENABLED",
} as const;

export type CsfWorker = keyof typeof workerEnv;
export type CsfWorkerFlags = Record<CsfWorker, boolean>;

const disabled = (): CsfWorkerFlags => ({
  workbook_refresh: false,
  import_commit: false,
  communications: false,
  scheduled_post_publisher: false,
});

export async function readCsfWorkerControls(): Promise<{
  workers: CsfWorkerFlags;
  mode: "environment" | "database";
  available: boolean;
}> {
  const closed = {
    workers: disabled(),
    mode: "database" as const,
    available: false,
  };
  const mode = process.env.CSF_WORKER_CONTROL_MODE;
  if (mode && mode !== "environment" && mode !== "database") return closed;
  if (mode !== "database") {
    // Preserve existing local and deployed environment controls for one release.
    const workers = disabled();
    for (const worker of Object.keys(workerEnv) as CsfWorker[]) {
      workers[worker] = process.env[workerEnv[worker]] === "true";
    }
    return { workers, mode: "environment", available: true };
  }
  const releaseSha = process.env.LETS_ASSIST_BUILD_SHA;
  if (!releaseSha || !/^[0-9a-f]{40}$/u.test(releaseSha)) return closed;
  try {
    const { data, error } = await getAdminClient()
      .rpc("read_csf_release_worker_controls", { p_release_sha: releaseSha })
      .abortSignal(AbortSignal.timeout(5_000));
    if (
      error ||
      data?.releaseSha !== releaseSha ||
      !Number.isSafeInteger(data?.revision) ||
      data.revision < 0 ||
      !data.workers ||
      Array.isArray(data.workers) ||
      Object.keys(data.workers).length !== 4
    )
      return closed;
    const workers = disabled();
    for (const worker of Object.keys(workerEnv) as CsfWorker[]) {
      if (typeof data.workers[worker] !== "boolean") return closed;
      workers[worker] = data.workers[worker];
    }
    return { workers, mode: "database", available: true };
  } catch {
    return closed;
  }
}

export async function isCsfWorkerEnabled(worker: CsfWorker): Promise<boolean> {
  return (await readCsfWorkerControls()).workers[worker];
}
