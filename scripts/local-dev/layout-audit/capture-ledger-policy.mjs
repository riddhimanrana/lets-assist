import { createHash } from "node:crypto";

const digest = (rows) =>
  createHash("sha256")
    .update(rows.join("\n") + "\n")
    .digest("hex");

export function verifyCaptureLedger(policy, rows) {
  if (
    policy.ledgerCount !== 723 ||
    policy.targetLedgerCount !== 739 ||
    !Array.isArray(rows) ||
    rows.length !== policy.targetLedgerCount ||
    rows.some((row) => typeof row !== "string" || !row.endsWith(".sql")) ||
    digest(rows.slice(0, policy.ledgerCount)) !==
      policy.ledgerGitObjectListSha256 ||
    digest(rows) !== policy.targetLedgerGitObjectListSha256
  )
    throw Error("Unreviewed capture migration ledger");
}
