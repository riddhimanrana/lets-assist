import { readFileSync } from "node:fs";
import { ReleaseCheckError } from "./app-release-checks.mjs";
import { ledgerDigest } from "./final-schema-manifest.mjs";

const ledgers = {
  688: {
    baseline: 687,
    baselineDigest:
      "d13565c216eb0c1c9085e9eacd736a6d6ce1a922b3c2ed7cebf9a089380ca425",
    hotfixDigest:
      "264d253f7f9d5f1171b7d6c5edc07e656f8be9914b829702c22686c5556f3eac",
  },
  689: {
    baseline: 688,
    baselineDigest:
      "9f7db7cf060c86a8ff4829cfe7a3c2e9acfbcd5ddd932ca4e1cff51bb813d404",
    hotfixDigest:
      "be6fb4fb7f795cc9efd1b340c18c18c374d0fe247ad1145c57be7770d0ae3488",
  },
};

// The two function digests are the reviewed 725 definitions. The relation
// digest is the read-only measured 687+725 Production result: migration 725's
// index is built on the older relation, so the clean 725 digest is different.
const overrides = [
  {
    identity: "function:plugin_data.csf_assert_activity_earning_award(",
    before: "579b488d795260f34196b9f6996072d9",
    after: "2deef61e7f6fcd61e0fb615fd837face",
  },
  {
    identity:
      "function:plugin_data.csf_begin_point_submission_authority_base_20260810(",
    before: "9d3956066cfa813caaeed33a24da87fb",
    after: "00cb6983044aba50bc99a777acf3c66b",
  },
  {
    identity: "relation:plugin_data.csf_point_submissions",
    before: "d2d4b73f9f161205621c73e39a501138",
    after: "eaeb217d9e5591f190679ac2c37c37ce",
  },
];

export function productionHotfixManifest(versions) {
  const variant = ledgers[versions.length];
  if (!variant || ledgerDigest(versions) !== variant.hotfixDigest)
    throw new ReleaseCheckError("Production hotfix ledger is not reviewed.");
  const manifest = JSON.parse(
    readFileSync(
      new URL(`./final-schema-${variant.baseline}.json`, import.meta.url),
      "utf8",
    ),
  );
  if (
    manifest.ledger !== variant.baselineDigest ||
    manifest.objects.length !== (variant.baseline === 687 ? 1298 : 1299)
  )
    throw new ReleaseCheckError("Production hotfix baseline catalog changed.");
  const changed = new Set();
  const objects = manifest.objects.map((row) => {
    const override = overrides.find((candidate) =>
      row.identity.startsWith(candidate.identity),
    );
    if (!override) return row;
    if (row.digest !== override.before || changed.has(override.identity))
      throw new ReleaseCheckError("Production hotfix catalog anchor changed.");
    changed.add(override.identity);
    return { ...row, digest: override.after };
  });
  if (changed.size !== overrides.length)
    throw new ReleaseCheckError("Production hotfix catalog is incomplete.");
  return { ...manifest, ledger: variant.hotfixDigest, objects };
}
