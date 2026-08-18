import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const oauthCallback = readFileSync(
  join(root, "app/api/google/oauth/callback/route.ts"),
  "utf8",
);
const waiverShared = readFileSync(
  join(root, "app/projects/[id]/server/shared.ts"),
  "utf8",
);
const paperScanCleanup = readFileSync(
  join(root, "app/api/cron/paper-scan-cleanup/route.ts"),
  "utf8",
);

describe("Production review round-three contracts", () => {
  test("OAuth stops before presenting a code when the exchange marker is not durable", () => {
    const markerIndex = oauthCallback.indexOf(
      "const exchangeMarked = await markGoogleOAuthAttemptExchanged(",
    );
    const refusalIndex = oauthCallback.indexOf("if (!exchangeMarked)");
    const exchangeIndex = oauthCallback.indexOf(
      'fetch("https://oauth2.googleapis.com/token"',
    );

    expect(markerIndex).toBeGreaterThan(0);
    expect(refusalIndex).toBeGreaterThan(markerIndex);
    expect(exchangeIndex).toBeGreaterThan(refusalIndex);
    expect(oauthCallback.slice(refusalIndex, exchangeIndex)).toContain(
      'error: "connection_in_progress"',
    );
  });

  test("failed waiver queue persistence falls back to direct object deletion", () => {
    const release = waiverShared.slice(
      waiverShared.indexOf(
        "export async function releaseUncommittedWaiverEvidence",
      ),
    );
    const queueIndex = release.indexOf("enqueueOrphanedWaiverEvidence(");
    const fallbackIndex = release.indexOf("removeWaiverStorageObjects(");

    expect(queueIndex).toBeGreaterThan(0);
    expect(fallbackIndex).toBeGreaterThan(queueIndex);
    expect(release.slice(queueIndex, fallbackIndex)).toContain("if (error)");
    expect(release).toContain(
      "serviceSupabase.storage.from(bucket).remove(paths)",
    );
  });

  test("a failed initial paper-scan drain cannot starve the transactional purge", () => {
    const initialDrainIndex = paperScanCleanup.indexOf(
      "const initialDrain = await drainPaperScanStorageDeletionQueue",
    );
    const purgeIndex = paperScanCleanup.indexOf(
      '"purge_expired_paper_scan_batches"',
    );
    const responseIndex = paperScanCleanup.indexOf(
      "const drainError = initialDrain.error ?? finalDrain.error",
    );

    expect(initialDrainIndex).toBeGreaterThan(0);
    expect(purgeIndex).toBeGreaterThan(initialDrainIndex);
    expect(responseIndex).toBeGreaterThan(purgeIndex);
    expect(paperScanCleanup.slice(initialDrainIndex, purgeIndex)).not.toContain(
      "return NextResponse.json",
    );
  });
});
