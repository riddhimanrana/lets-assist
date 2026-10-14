import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { expectedVersions } from "./app-release-checks.mjs";
import { reviewedDevelopmentVersions } from "./reconciliation-ledgers.mjs";
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
const versions = reviewedDevelopmentVersions(expectedVersions(root)).slice(
  0,
  727,
);
const manifestFile = new URL("./final-schema-727.json", import.meta.url);
const manifestBytes = readFileSync(manifestFile);
const manifest = JSON.parse(manifestBytes);
const previous = JSON.parse(
  readFileSync(new URL("./final-schema-725.json", import.meta.url), "utf8"),
);

test("the 727 target binds the reviewed clean replay and unchanged migration bytes", () => {
  assert.equal(versions.length, 727);
  assert.equal(versions.at(-1), "20261014060423");
  assert.equal(
    ledgerDigest(versions),
    "41e425279139fea40028f2c46586b074f188743ee38ff5a2f08101aa851d0b5b",
  );
  assert.throws(() => maintenanceTarget(root), /explicit release review/u);
  assert.equal(
    createHash("sha256").update(manifestBytes).digest("hex"),
    "71609fa0fafcd592377d9ad85e5e40f52fba9eee5db8b43f491d787e35a24962",
  );
  for (const [name, digest] of [
    [
      "20261014050438_preserve_self_reported_certificate_timezone.sql",
      "e5bef0c9cee06d99f6a18aa80a592f35195487a3b938efb53cdf6f03b216e053",
    ],
    [
      "20261014060423_validate_and_project_certificate_timezones.sql",
      "17d4b5b3c0f04c3dfb45d62d2ea7e81822ae4aee639e15d74958dcc6371f1a24",
    ],
  ]) {
    assert.equal(
      createHash("sha256")
        .update(
          readFileSync(
            new URL(`../../supabase/migrations/${name}`, import.meta.url),
          ),
        )
        .digest("hex"),
      digest,
    );
  }
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

test("the reviewed 727 inventory changes only certificate timezone objects", () => {
  const before = new Map(
    previous.objects.map((row) => [row.identity, row.digest]),
  );
  const after = new Map(
    manifest.objects.map((row) => [row.identity, row.digest]),
  );
  assert.equal(after.size, 1441);
  assert.deepEqual(
    [...after.keys()].filter((identity) => !before.has(identity)),
    ["function:private.enforce_certificate_event_timezone()"],
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
    [
      "relation:public.certificate_verification_read_model",
      "relation:public.certificates",
      "relation:public.user_certificate_read_model",
    ],
  );
});
