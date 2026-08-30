import "server-only";

import { commitCsfSheetSyncAction } from "@/lib/plugins/private/plugins/dvhs-csf/server/actions/import-commit";
import type { CsfImportCommitWorkerContext } from "@/lib/plugins/private/plugins/dvhs-csf/services/import-commit-worker-context";

export async function executeCsfImportCommitClaim(options: {
  organizationId: string;
  previewJobId: string;
  workerContext: CsfImportCommitWorkerContext;
}) {
  const formData = new FormData();
  formData.set("jobId", options.previewJobId);
  return commitCsfSheetSyncAction(
    options.organizationId,
    formData,
    options.workerContext,
  );
}
