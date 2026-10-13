import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { expectedVersions } from "./app-release-checks.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { finalSchemaCatalog } from "./final-schema-manifest.mjs";
import { maintenanceTarget } from "./maintenance-preflight.mjs";
import { projectStatusCronCatalog } from "./project-status-cron-catalog.mjs";
import { publishedEmbedded721Catalog } from "./published-embedded-721-catalog.mjs";
import { pausedSpeechDebateCatalog } from "./paused-speech-debate-catalog.mjs";
import { publicImageStorageCatalog } from "./public-image-storage-catalog.mjs";
import { accountDeletionStorageCatalog } from "./account-deletion-storage-catalog.mjs";
import { csfSubmissionDeletionCatalog } from "./csf-submission-deletion-catalog.mjs";

const root = new URL("../../", import.meta.url).pathname;
const versions = expectedVersions(root);
const manifest = JSON.parse(
  readFileSync(new URL("./final-schema-724.json", import.meta.url), "utf8"),
);
const previous = JSON.parse(
  readFileSync(new URL("./final-schema-723.json", import.meta.url), "utf8"),
);

test("the clean tested724 replay retains every release boundary and exact migration bytes", () => {
  assert.equal(versions.length, 724);
  assert.equal(versions.at(-1), "20261013010957");
  assert.deepEqual(maintenanceTarget(root), versions);
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
});

test("the new manifest changes only the reviewed worker pair and adds its private parser", () => {
  const before = new Map(
    previous.objects.map((row) => [row.identity, row.digest]),
  );
  const after = new Map(
    manifest.objects.map((row) => [row.identity, row.digest]),
  );
  assert.equal(after.size, before.size + 1);
  assert.deepEqual(
    [...before.keys()].filter((key) => !after.has(key)),
    [],
  );
  assert.deepEqual(
    [...after.keys()].filter((key) => !before.has(key)),
    [
      "function:private.project_attendance_slot_window(p_project_id uuid, p_schedule_id text)",
    ],
  );
  assert.deepEqual(
    [...before.keys()].filter((key) => before.get(key) !== after.get(key)),
    [
      "function:public.process_automatic_check_ins()",
      "function:public.process_automatic_check_outs()",
    ],
  );
});

test("unknown migrations cannot reuse this target or weaken catalog identity", () => {
  assert.throws(() =>
    acceptedCatalogQuery("", [...versions, "20990101000000"]),
  );
  assert.throws(() => finalSchemaCatalog(manifest, versions.slice(0, -1)));
});
