import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { expectedVersions } from "./app-release-checks.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { finalSchemaCatalog, ledgerDigest } from "./final-schema-manifest.mjs";
import { maintenanceTarget } from "./maintenance-preflight.mjs";
import { projectStatusCronCatalog } from "./project-status-cron-catalog.mjs";
import { publishedEmbedded721Catalog } from "./published-embedded-721-catalog.mjs";
import { pausedSpeechDebateCatalog } from "./paused-speech-debate-catalog.mjs";
import { publicImageStorageCatalog } from "./public-image-storage-catalog.mjs";
import { accountDeletionStorageCatalog } from "./account-deletion-storage-catalog.mjs";
import { csfSubmissionDeletionCatalog } from "./csf-submission-deletion-catalog.mjs";
import { reviewedDevelopmentVersions } from "./reconciliation-ledgers.mjs";

const root = new URL("../../", import.meta.url).pathname;
const versions = reviewedDevelopmentVersions(expectedVersions(root));
const manifestBytes = readFileSync(
  new URL("./final-schema-729.json", import.meta.url),
);
const manifest = JSON.parse(manifestBytes);
const previous = JSON.parse(
  readFileSync(new URL("./final-schema-728.json", import.meta.url), "utf8"),
);

test("the 729 target binds the reviewed shared formatter zone guard", () => {
  assert.equal(versions.length, 729);
  assert.equal(versions.at(-1), "20261014162331");
  assert.throws(() => maintenanceTarget(root), /explicit release review/u);
  assert.equal(
    ledgerDigest(versions),
    "5683053e8fc69f99c841ece8d1c0f8447dba68a933369692a94ae1fc0703e90c",
  );
  assert.equal(
    createHash("sha256").update(manifestBytes).digest("hex"),
    "f95a2ae9957dc404299278670beab482f0d3a3484a9e49a5de99f01305866b61",
  );
  assert.equal(
    createHash("sha256")
      .update(
        readFileSync(
          new URL(
            "../../supabase/migrations/20261014162331_enforce_formatter_certificate_timezones.sql",
            import.meta.url,
          ),
        ),
      )
      .digest("hex"),
    "b5831c1929dc1bf5fe83c3033e05be0699fb7366949a3817b6345f86a2104b21",
  );
  assert.equal(
    acceptedCatalogQuery("untrusted predecessor", versions),
    projectStatusCronCatalog(
      publishedEmbedded721Catalog(
        pausedSpeechDebateCatalog(
          publicImageStorageCatalog(
            accountDeletionStorageCatalog(
              csfSubmissionDeletionCatalog(
                finalSchemaCatalog(manifest, versions),
              ),
            ),
          ),
        ),
      ),
    ),
  );
  assert.throws(() =>
    acceptedCatalogQuery("", [...versions, "20990101000000"]),
  );
  assert.throws(() => finalSchemaCatalog(manifest, versions.slice(0, -1)));
});

test("the 729 inventory changes only the certificate timezone guard", () => {
  const before = new Map(
    previous.objects.map((row) => [row.identity, row.digest]),
  );
  const after = new Map(
    manifest.objects.map((row) => [row.identity, row.digest]),
  );
  assert.equal(after.size, 1441);
  assert.deepEqual(
    [...after.keys()].filter((identity) => !before.has(identity)),
    [],
  );
  assert.deepEqual(
    [...before.keys()].filter((identity) => !after.has(identity)),
    [],
  );
  assert.deepEqual(
    [...after.keys()].filter(
      (identity) =>
        before.has(identity) && before.get(identity) !== after.get(identity),
    ),
    ["function:private.enforce_certificate_event_timezone()"],
  );
  assert.equal(
    after.get("function:private.enforce_certificate_event_timezone()"),
    "c2f9b2b11906d1ebae71a02742b2c30e",
  );
});
