export type PaperCommitAttempt = {
  key: string;
  signature: string;
  rowIds: string[];
};

type ReviewedCommitInput = {
  projectId: string;
  batchId: string;
  allowOverCapacity: boolean;
  rows: Array<{ id: string; reviewRevision: number; decision: string }>;
};

// An uncertain response keeps its key until the reviewed input changes. Include
// revisions because editing a failed row can change its attendance without
// changing the row IDs accepted by the commit RPC.
export function nextPaperCommitAttempt(
  previous: PaperCommitAttempt | null,
  input: ReviewedCommitInput,
  createKey: () => string = () => crypto.randomUUID(),
): PaperCommitAttempt {
  const rows = input.rows
    .map(({ id, reviewRevision, decision }) => ({
      id,
      reviewRevision,
      decision,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const signature = JSON.stringify({
    projectId: input.projectId,
    batchId: input.batchId,
    allowOverCapacity: input.allowOverCapacity,
    rows,
  });
  if (previous?.signature === signature) return previous;
  return { key: createKey(), signature, rowIds: rows.map(({ id }) => id) };
}
