import "server-only";
import { getAdminClient } from "@/lib/supabase/admin";
import { evaluateWorkerHealth, type WorkerScope } from "./worker-health";

// The caller supplies separately verified scheduler and missed-run alert evidence.
export async function readWorkerHealth(policy: unknown, scope: WorkerScope) {
  try {
    const { data, error } = await getAdminClient()
      .rpc("read_worker_run_receipts", {
        p_worker_key: scope.worker,
        p_environment: scope.environment,
      })
      .abortSignal(AbortSignal.timeout(2_000));
    if (error) throw new Error("worker_health_read_unavailable");
    return evaluateWorkerHealth(data, policy, scope);
  } catch {
    return {
      ...scope,
      outcome: "failed" as const,
      code: "receipt_store_unavailable",
      actionRequired: true,
      monitoringReady: false,
      latest: null,
    };
  }
}
