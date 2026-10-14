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

const root = new URL("../../", import.meta.url).pathname;
const versions = expectedVersions(root).slice(0, 728);
const manifestBytes = readFileSync(
  new URL("./final-schema-728.json", import.meta.url),
);
const manifest = JSON.parse(manifestBytes);
const previous = JSON.parse(
  readFileSync(new URL("./final-schema-727.json", import.meta.url), "utf8"),
);

test("the 728 target binds the reviewed forward timezone guard", () => {
  assert.equal(versions.length, 728);
  assert.equal(versions.at(-1), "20261014142100");
  assert.deepEqual(maintenanceTarget(root).slice(0, 728), versions);
  assert.equal(
    ledgerDigest(versions),
    "b54353c4317401b5fcac6245b19b3fcf18fd24fde9d1fa50d7e100f54207101c",
  );
  assert.equal(
    createHash("sha256").update(manifestBytes).digest("hex"),
    "f220aa1f04092dd55b472552f65b98f165a3c022aafc53d6696d99f007d853cc",
  );
  assert.equal(
    createHash("sha256")
      .update(
        readFileSync(
          new URL(
            "../../supabase/migrations/20261014142100_reject_unsupported_certificate_timezone.sql",
            import.meta.url,
          ),
        ),
      )
      .digest("hex"),
    "83cbf1ed33b166bc9f8a7f2e7ae59d19cb5ce54eb9366ad277b970a1015f34c8",
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

test("the 728 inventory changes only the certificate timezone guard", () => {
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
});
