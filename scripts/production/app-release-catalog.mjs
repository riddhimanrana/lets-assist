import { readFileSync } from "node:fs";
import { finalSchemaCatalog, ledgerDigest } from "./final-schema-manifest.mjs";
import { cronHistoryCatalog } from "./cron-history-catalog.mjs";
import { semesterLedgerReconciliationCatalog } from "./semester-ledger-reconciliation-catalog.mjs";
import { semesterLedgerClaimIdentityCatalog } from "./semester-ledger-claim-identity-catalog.mjs";
import { semesterLedgerRecoveryCatalog } from "./semester-ledger-recovery-catalog.mjs";
import { semesterLedgerMergeClaimCatalog } from "./semester-ledger-merge-claim-catalog.mjs";
import { semesterLedgerAuthorityCatalog } from "./semester-ledger-authority-catalog.mjs";
import { noticeLedgerCatalog } from "./notice-ledger-catalog.mjs";
import { csf588Catalog } from "./csf-588-catalog.mjs";
import { csf589Catalog } from "./csf-589-catalog.mjs";
import { csf590Catalog } from "./csf-590-catalog.mjs";
import { csf591Catalog } from "./csf-591-catalog.mjs";
import { csf592Catalog } from "./csf-592-catalog.mjs";
import { csf593Catalog } from "./csf-593-catalog.mjs";
import { csf594Catalog } from "./csf-594-catalog.mjs";
import { csf595Catalog } from "./csf-595-catalog.mjs";
import { csf596Catalog } from "./csf-596-catalog.mjs";
import { csf597Catalog } from "./csf-597-catalog.mjs";
import { csf598Catalog } from "./csf-598-catalog.mjs";
import { csf599Catalog } from "./csf-599-catalog.mjs";
import { csf600Catalog } from "./csf-600-catalog.mjs";
import { csf602Catalog } from "./csf-602-catalog.mjs";
import { csf603Catalog } from "./csf-603-catalog.mjs";
import { csf604Catalog } from "./csf-604-catalog.mjs";
import { csf605Catalog } from "./csf-605-catalog.mjs";
import { csf606Catalog } from "./csf-606-catalog.mjs";
import { csf607Catalog } from "./csf-607-catalog.mjs";
import { csf608Catalog } from "./csf-608-catalog.mjs";
import { csf609Catalog } from "./csf-609-catalog.mjs";
import { csf610Catalog } from "./csf-610-catalog.mjs";
import { csf611Catalog } from "./csf-611-catalog.mjs";
import { csf612Catalog } from "./csf-612-catalog.mjs";
import { csf613Catalog } from "./csf-613-catalog.mjs";
import { csf614Catalog } from "./csf-614-catalog.mjs";
import { csf615Catalog } from "./csf-615-catalog.mjs";
import { csf616Catalog } from "./csf-616-catalog.mjs";
import { csf617Catalog } from "./csf-617-catalog.mjs";
import { csf618Catalog } from "./csf-618-catalog.mjs";
import { csf619Catalog } from "./csf-619-catalog.mjs";
import { csf620Catalog } from "./csf-620-catalog.mjs";
import { csf621Catalog } from "./csf-621-catalog.mjs";
import {
  historyIdentityLedgers,
  historyIdentityCatalog,
  resolvedClassRecoveryCatalog,
} from "./history-identity-catalog.mjs";
import {
  publicationNotificationDefinitions,
  publicationNotificationPosture,
} from "./publication-notification-catalog.mjs";
import { sheetDiscussionWriteDefinitions } from "./sheet-discussion-write-catalog.mjs";
import { sheetToggleDefinitions } from "./sheet-toggle-catalog.mjs";
import {
  sheetNoCommentsDefinitions,
  sheetNoCommentsTables,
} from "./sheet-no-comments-catalog.mjs";
import { sheetDeferredNoteDefinitions } from "./sheet-deferred-note-catalog.mjs";
import {
  sheetObservationDefinitions,
  sheetObservationTables,
} from "./sheet-observation-catalog.mjs";
import {
  sheetRecoveryDefinitions,
  sheetRecoveryTables,
} from "./sheet-recovery-catalog.mjs";
import {
  sheetDiscussionDefinitions,
  sheetDiscussionTables,
} from "./sheet-discussion-catalog.mjs";
import { sheetSyncPosture } from "./sheet-sync-catalog.mjs";
import {
  ownershipDefinitions,
  reportedContactColumnsPosture,
} from "./account-ownership-catalog.mjs";
import { createHash } from "node:crypto";
import { ReleaseCheckError } from "./app-release-checks.mjs";
import { officerIdentityAuthorityCatalog } from "./officer-identity-authority-catalog.mjs";
import {
  classBlockAcceptanceCatalog,
  decisionMergeOwnershipCatalog,
  decisionStagingRelationCatalog,
  decisionSupersedeCatalog,
  officerActivityRelationCatalog,
} from "./readiness-catalog-drift.mjs";
import {
  mergedSourceLineagePosture,
  reviewedWorkbookLinksPosture,
} from "./workbook-profile-link-catalog.mjs";
import { automaticSheetUpdatesPosture } from "./automatic-sheet-update-catalog.mjs";
import { staffAccountConnectionPosture } from "./staff-account-connection-catalog.mjs";
import { workbookLinkMergePosture } from "./workbook-link-merge-catalog.mjs";
import {
  csfFinalGuardDefinitions,
  csfApplicationImportNoopDefinitions,
  csfMixedCategoryResubmissionDefinitions,
  csfOneTwoFortySixDefinitions,
  csfOneTwoFortySixPosture,
} from "./csf-1-2-46-catalog.mjs";

export const workerRelationSnapshotQuery = `SELECT c.relname, md5(jsonb_build_object(
  'owner', pg_get_userbyid(c.relowner), 'kind', c.relkind,
  'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity,
  'acl', c.relacl::text,
  'columns', (SELECT jsonb_agg(jsonb_build_array(a.attname,
    format_type(a.atttypid,a.atttypmod), a.attnotnull,
    pg_get_expr(d.adbin,d.adrelid), a.attidentity, a.attgenerated, a.attacl::text)
    ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d
    ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
  'constraints', (SELECT jsonb_agg(jsonb_build_array(k.conname,
    pg_get_constraintdef(k.oid),k.convalidated,k.condeferrable,k.condeferred)
    ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid=c.oid),
  'indexes', (SELECT jsonb_agg(jsonb_build_array(pg_get_indexdef(i.indexrelid),
    i.indisvalid,i.indisready) ORDER BY pg_get_indexdef(i.indexrelid) COLLATE "C")
    FROM pg_index i WHERE i.indrelid=c.oid),
  'triggers', (SELECT jsonb_agg(jsonb_build_array(pg_get_triggerdef(t.oid),
    t.tgenabled) ORDER BY t.tgname) FROM pg_trigger t
    WHERE t.tgrelid=c.oid AND NOT t.tgisinternal),
  'policies', (SELECT count(*) FROM pg_policy p WHERE p.polrelid=c.oid)
)::text) AS digest,
NOT EXISTS (SELECT 1 FROM (VALUES ('anon'),('authenticated'),('service_role')) roles(name)
  WHERE has_table_privilege(roles.name,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    OR has_any_column_privilege(roles.name,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')) AS runtime_denied
FROM pg_class c WHERE c.relpersistence = 'p' AND c.oid IN (
  to_regclass('app_private.csf_release_worker_controls'),
  to_regclass('app_private.csf_release_worker_receipts'))`;

// Function definitions from the exact hosted-accepted 446-migration catalog.
const acceptedDefinitions = [
  [
    "app_private.protect_csf_release_worker_receipt()",
    "13b93bbdb8bc561985863a0e5e5fa14f",
    false,
  ],
  [
    "app_private.set_csf_release_worker_control(text,text,boolean,bigint,uuid,text,text)",
    "1e41a41793d76980edb8fd30f1e4b5ad",
    false,
  ],
  [
    "plugin_data.csf_confirm_class_code_account_name_match_v4(uuid,uuid,uuid,text,uuid,uuid,text,text,text)",
    "6d2494c3f65510af06f214241a83bb87",
    true,
  ],
  [
    "plugin_data.csf_find_account_name_candidate(uuid,uuid,text)",
    "40fa35c59381c8dbc07a7e001881122f",
    true,
  ],
  [
    "plugin_data.csf_record_connection_basis()",
    "2bb49e2e9b35ef542840c3a0f24ab454",
    false,
  ],
  [
    "plugin_data.csf_revalidate_class_code_connection_replay(uuid,uuid,uuid,uuid,jsonb)",
    "407562642ac0bbf5cff10501c549dd2e",
    false,
  ],
  [
    "plugin_data.csf_revalidate_class_code_connection_replay_legacy(uuid,uuid,uuid,uuid,jsonb)",
    "3b3e734fe920f885aa3b2d08f3b313a5",
    false,
  ],
  [
    "public.read_csf_release_worker_controls(text)",
    "a3e5236a9ae2bc7d54ffcd600fab0798",
    true,
  ],
];

const importReviewDefinitions = [
  [
    "plugin_data.csf_reconcile_sheet_import_row_identity_base(uuid,uuid,uuid,text,text,uuid,uuid,jsonb)",
    "9d5b02f7b4cdb7c948aad0398ed29bdf",
    false,
  ],
  [
    "plugin_data.csf_commit_meeting_attendance_import_identity_base(uuid,uuid,uuid,text,uuid,uuid,boolean)",
    "641568ea97cc01fff75298d218a1404d",
    false,
  ],
];

// The 561 release is the first extension set since the decisions lane, and it
// is the first in a while that moves reviewed fingerprints rather than passing
// through. 0900 and 1100 touch nothing the accepted catalog pins. 0700 restates
// one pinned function, and 0800 restates three pinned functions, one pinned
// trigger function, and the shape of one pinned relation.
//
// Each `after` is md5(pg_get_functiondef(oid)) or, for a relation, the
// jsonb_build_object digest the catalog computes. Neither can be derived from
// the migration text, so every value here has to be read off a database that
// has the migration applied. The four that are filled came from the owned
// replay T. The two that are null moved but were not measured, and the release
// cannot be pinned until they are.
export const acceptedFingerprints565 = [
  {
    object:
      "plugin_data.csf_join_class_by_code_identity_base(uuid,text,uuid,text,text,text,text,uuid,uuid)",
    migration: "20260917070000",
    before: "0c9f17d6f6b50b484ae8758b26d5858b",
    after: "abe1520dabf116c9ce2b7adb0a9f0156",
    occurrences: 2,
  },
  {
    object:
      "plugin_data.csf_authorize_publication_notification(uuid,uuid,uuid)",
    migration: "20260917080000",
    before: "45955f667a0dc934e86b2980a695d683",
    after: "f494ecf0746444bbb55bf2605123ab2a",
    occurrences: 1,
  },
  {
    object: "plugin_data.csf_publication_email_recipient_allowed(uuid,uuid)",
    migration: "20260917080000",
    before: "d611bc91327412cad303c1e17123794f",
    after: "57c41026b33ca412f0b73645d520b795",
    occurrences: 1,
  },
  {
    object:
      "plugin_data.csf_publication_recipient_allowed(uuid,text,uuid,uuid)",
    migration: "20260917080000",
    before: "410dfba2b96511bae6548134e51539c4",
    after: "1737ebf7d2e061b504c2721e4e113dde",
    occurrences: 1,
  },
  {
    object: "plugin_data.csf_record_publication_notifications()",
    migration: "20260917080000",
    before: "396db81ca1f3953148782858f9185223",
    after: "9900f3e2f5181fdce4329ce958e1b2c3",
    occurrences: 1,
  },
  {
    // 0800 rewrites its constraints.
    object: "plugin_data.csf_publication_events (relation)",
    migration: "20260917080000",
    before: "bb442786fe77c77ce3adae4aa0e84ac8",
    after: "73d189ff60d9248b33faaf010a5aa1cd",
    occurrences: 1,
  },
  {
    // 1300 adds courses_corrected_at and courses_corrected_by.
    object: "plugin_data.csf_term_applications (relation)",
    migration: "20260917130000",
    before: "9be38d4860e44a5696c75358d3707efc",
    after: "80588947c1e1b304dc388ec9bd4e48d6",
    occurrences: 1,
  },
  {
    // 1100 indexes the attendance-correction request.
    object: "plugin_data.csf_admin_audit_events (relation)",
    migration: "20260917110000",
    before: "f4cccde4b50d4e96dac5937200b95ea1",
    after: "317cf813aa3f7dfdedaa8a21ac872343",
    occurrences: 1,
  },
  {
    // 1400 adds the personal-notification trigger to this table.
    object: "plugin_data.csf_point_submissions (relation)",
    migration: "20260917140000",
    before: "db32b25e5818c2067614aebe169f4cb9",
    after: "edb4d3ebac961c453ddc975fac463612",
    occurrences: 1,
  },
];

function swapAcceptedFingerprints(catalog, replacements) {
  const unmeasured = replacements.filter(
    (entry) => !entry.after || !entry.before,
  );
  if (unmeasured.length)
    throw new ReleaseCheckError(
      `Accepted fingerprints moved but were never measured: ${unmeasured
        .map((entry) => `${entry.object} (${entry.migration})`)
        .join("; ")}. Read them from a database with the migration applied.`,
    );
  let swapped = catalog;
  for (const entry of replacements) {
    const found = swapped.split(entry.before).length - 1;
    if (found !== entry.occurrences)
      throw new ReleaseCheckError(
        `Expected ${entry.occurrences} pinned fingerprint(s) for ${entry.object}, found ${found}.`,
      );
    if (swapped.includes(entry.after))
      throw new ReleaseCheckError(
        `The replacement fingerprint for ${entry.object} is already in the catalog.`,
      );
    swapped = swapped.replaceAll(entry.before, entry.after);
  }
  return swapped;
}

function reconcileCsf620SupersededStorageChecks(catalog) {
  const replacements = [
    [
      `AND pg_catalog.strpos(p.prosrc, 'DELETE FROM plugin_data.csf_announcement_attachments')
          < pg_catalog.strpos(p.prosrc, 'DELETE FROM plugin_data.csf_storage_deletion_queue')`,
      `AND pg_catalog.strpos(p.prosrc, 'DELETE FROM plugin_data.csf_storage_deletion_queue') = 0`,
      1,
    ],
    [
      `AND pg_catalog.strpos(
          procedure_record.prosrc,
          'IF v_queue_rows > 0 THEN'
        ) < pg_catalog.strpos(
          procedure_record.prosrc,
          'DELETE FROM plugin_data.csf_attachment_restore_preparations'
        )`,
      `AND pg_catalog.strpos(
          procedure_record.prosrc,
          'IF v_queue_rows > 0 THEN'
        ) > 0`,
      1,
    ],
    [
      `AND pg_catalog.strpos(
          procedure_record.prosrc,
          'FOR UPDATE SKIP LOCKED'
        ) > 0`,
      `AND pg_catalog.strpos(
          procedure_record.prosrc,
          'FOR UPDATE OF queue SKIP LOCKED'
        ) > 0`,
      2,
    ],
    [
      `AND pg_catalog.strpos(p.prosrc, 'FOR UPDATE SKIP LOCKED') > 0`,
      `AND pg_catalog.strpos(p.prosrc, 'FOR UPDATE OF queue SKIP LOCKED') > 0`,
      1,
    ],
  ];
  let reconciled = catalog;
  for (const [before, after, expectedOccurrences] of replacements) {
    const occurrences = reconciled.split(before).length - 1;
    if (occurrences !== expectedOccurrences)
      throw new ReleaseCheckError(
        `Expected ${expectedOccurrences} superseded 620 Storage catalog fragment(s), found ${occurrences}.`,
      );
    reconciled = reconciled.replaceAll(before, after);
  }
  return reconciled;
}

export function acceptedCatalogQuery(source, versions) {
  if (
    ledgerDigest(versions) ===
    "239c8f7ce73febfbf7e72160152274e182e1e8cca945d8c4c005c49c7fae9bdf"
  ) {
    return finalSchemaCatalog(
      JSON.parse(
        readFileSync(
          new URL("./final-schema-658.json", import.meta.url),
          "utf8",
        ),
      ),
      versions,
    );
  }

  if (
    ledgerDigest(versions) ===
    "eb98692308a133916008b74043e69782bd595171e8ee3778dda05310b12e92b7"
  ) {
    return finalSchemaCatalog(
      JSON.parse(
        readFileSync(
          new URL("./final-schema-657.json", import.meta.url),
          "utf8",
        ),
      ),
      versions,
    );
  }

  if (
    ledgerDigest(versions) ===
    "272418f582d3ec097e31553a8d15f6be6d36e43f6cce1856f140a02db25a427f"
  ) {
    return finalSchemaCatalog(
      JSON.parse(
        readFileSync(
          new URL("./final-schema-656.json", import.meta.url),
          "utf8",
        ),
      ),
      versions,
    );
  }

  if (
    ledgerDigest(versions) ===
    "1c975d0799cb952b13317381dc7a0ec94601d5ba2d85d0a1fbf364c0e2e08ac5"
  ) {
    return finalSchemaCatalog(
      JSON.parse(
        readFileSync(
          new URL("./final-schema-655.json", import.meta.url),
          "utf8",
        ),
      ),
      versions,
    );
  }

  if (
    ledgerDigest(versions) ===
    "c13c183a6632f5be6f7439d843321adfb5f08f030a5c57ec4e95e1b4b54dd1ed"
  ) {
    return finalSchemaCatalog(
      JSON.parse(
        readFileSync(
          new URL("./final-schema-654.json", import.meta.url),
          "utf8",
        ),
      ),
      versions,
    );
  }

  if (
    ledgerDigest(versions) ===
    "407b174684eda5c46b256c3ff5d9bd324815edd8926ff0559bccc4b35e32e8a8"
  ) {
    return finalSchemaCatalog(
      JSON.parse(
        readFileSync(
          new URL("./final-schema-653.json", import.meta.url),
          "utf8",
        ),
      ),
      versions,
    );
  }

  if (
    ledgerDigest(versions) ===
    "b17fa82961232d465d03daa17778ea77c352805c732578622849ff668b071106"
  ) {
    return finalSchemaCatalog(
      JSON.parse(
        readFileSync(
          new URL("./final-schema-652.json", import.meta.url),
          "utf8",
        ),
      ),
      versions,
    );
  }

  if (
    ledgerDigest(versions) ===
    "058c43e0cea9ca9a8d9d810a3ad034b49ccbee78b281b7c06bc2dea48d3cec48"
  ) {
    return finalSchemaCatalog(
      JSON.parse(
        readFileSync(
          new URL("./final-schema-651.json", import.meta.url),
          "utf8",
        ),
      ),
      versions,
    );
  }
  if (
    ledgerDigest(versions) ===
    "e29356e5dee152b36cec3a3200da2a0e9b498b49ce86041015f832abfd62b0ad"
  ) {
    return finalSchemaCatalog(
      JSON.parse(
        readFileSync(
          new URL("./final-schema-650.json", import.meta.url),
          "utf8",
        ),
      ),
      versions,
    );
  }
  if (
    ledgerDigest(versions) ===
    "6724bea264961162818d9b569329ef41e2d6d249763499f49caa7c5f5c253c47"
  ) {
    return finalSchemaCatalog(
      JSON.parse(
        readFileSync(
          new URL("./final-schema-649.json", import.meta.url),
          "utf8",
        ),
      ),
      versions,
    );
  }
  if (
    ledgerDigest(versions) ===
    "8668d5a8894488faf2763de07b23f6e52711175b283d0fa41ca7e62d38a39dd3"
  ) {
    return finalSchemaCatalog(
      JSON.parse(
        readFileSync(
          new URL("./final-schema-648.json", import.meta.url),
          "utf8",
        ),
      ),
      versions,
    );
  }
  if (
    ledgerDigest(versions) ===
    "6a7bc017be63769c96184429f5f1b38f564563c3cefd06200a32698b643fe601"
  ) {
    return finalSchemaCatalog(
      JSON.parse(
        readFileSync(
          new URL("./final-schema-647.json", import.meta.url),
          "utf8",
        ),
      ),
      versions,
    );
  }
  if (
    ledgerDigest(versions) ===
    "9e829405873a50245d250a6d38a363b5079dab61aa8ac96fe69ea6c435f552b1"
  ) {
    return finalSchemaCatalog(
      JSON.parse(
        readFileSync(
          new URL("./final-schema-646.json", import.meta.url),
          "utf8",
        ),
      ),
      versions,
    );
  }
  if (
    ledgerDigest(versions) ===
    "c55318b003133b512cefe89e7da520963e8f2035f8b2a5a713dd6121b39d03f4"
  ) {
    return finalSchemaCatalog(
      JSON.parse(
        readFileSync(
          new URL("./final-schema-645.json", import.meta.url),
          "utf8",
        ),
      ),
      versions,
    );
  }
  if (
    ledgerDigest(versions) ===
    "e00e15892ea25405e0b014199907aab23c502adbf380ddeb90c3ba05877229f4"
  ) {
    return finalSchemaCatalog(
      JSON.parse(
        readFileSync(
          new URL("./final-schema-644.json", import.meta.url),
          "utf8",
        ),
      ),
      versions,
    );
  }
  if (
    ledgerDigest(versions) ===
    "0220a010c2f275170941a7858fd4aa3977ffc1b66b16636b0bcb75cbea68b366"
  ) {
    return finalSchemaCatalog(
      JSON.parse(
        readFileSync(
          new URL("./final-schema-643.json", import.meta.url),
          "utf8",
        ),
      ),
      versions,
    );
  }
  if (
    ledgerDigest(versions) ===
    "6d7eb7641659813b342bfc1451787da0686b0acb6ac334f523f33bacbf9431d3"
  ) {
    return finalSchemaCatalog(
      JSON.parse(
        readFileSync(
          new URL("./final-schema-642.json", import.meta.url),
          "utf8",
        ),
      ),
      versions,
    );
  }
  if (
    ledgerDigest(versions) ===
    "dcfa4fbda9288d39e51909ac56f3121331c3e43b7e480cd25c6ad671db206947"
  ) {
    return finalSchemaCatalog(
      JSON.parse(
        readFileSync(
          new URL("./final-schema-641.json", import.meta.url),
          "utf8",
        ),
      ),
      versions,
    );
  }
  if (
    ledgerDigest(versions) ===
    "17ee39b59fd2ec0749ad9c18fe81ad268af3a38e8980ff2c2d1bd8125414e674"
  ) {
    return finalSchemaCatalog(
      JSON.parse(
        readFileSync(
          new URL("./final-schema-640.json", import.meta.url),
          "utf8",
        ),
      ),
      versions,
    );
  }

  if (
    ledgerDigest(versions) ===
    "87d4561134e95f53c565f2c2317560114878b6fa657b35e8ce5332ef6f99a38c"
  ) {
    return finalSchemaCatalog(
      JSON.parse(
        readFileSync(
          new URL("./final-schema-639.json", import.meta.url),
          "utf8",
        ),
      ),
      versions,
    );
  }

  if (
    ledgerDigest(versions) ===
    "4e96d37cd4e572aecc101b27f9c20806c5f6c02c2b36b6bc4d86ce4556e9f0a7"
  ) {
    return finalSchemaCatalog(
      JSON.parse(
        readFileSync(
          new URL("./final-schema-638.json", import.meta.url),
          "utf8",
        ),
      ),
      versions,
    );
  }

  if (
    ledgerDigest(versions) ===
    "fe689bbb1a464e61f0fec66784ba922b2a168a5df572ee001cfb7e1a38962407"
  ) {
    return finalSchemaCatalog(
      JSON.parse(
        readFileSync(
          new URL("./final-schema-635.json", import.meta.url),
          "utf8",
        ),
      ),
      versions,
    );
  }

  if (
    ledgerDigest(versions) ===
    "aad0595f0b004bd1119ef65fb79f5853fafdf070b6043c38e633f90125a2759c"
  ) {
    return finalSchemaCatalog(
      JSON.parse(
        readFileSync(
          new URL("./final-schema-634.json", import.meta.url),
          "utf8",
        ),
      ),
      versions,
    );
  }

  if (
    ledgerDigest(versions) ===
    "6f53ecdacc03a9df6e9b94115c206b4df2c1331990cde528f765ce21ca2f45c5"
  ) {
    return finalSchemaCatalog(
      JSON.parse(
        readFileSync(
          new URL("./final-schema-633.json", import.meta.url),
          "utf8",
        ),
      ),
      versions,
    );
  }

  if (
    ledgerDigest(versions) ===
    "5811020bffb146f540962a17a019722949bbc8c4a75328653fe53028371b07c3"
  ) {
    return finalSchemaCatalog(
      JSON.parse(
        readFileSync(
          new URL("./final-schema-632.json", import.meta.url),
          "utf8",
        ),
      ),
      versions,
    );
  }
  if (
    ledgerDigest(versions) ===
    "ef8966427bb1ad5c66ea8ab6e0927dcfa04f17aaf9ac224de53a65712e36b521"
  ) {
    return finalSchemaCatalog(
      JSON.parse(
        readFileSync(
          new URL("./final-schema-631.json", import.meta.url),
          "utf8",
        ),
      ),
      versions,
    );
  }
  if (
    ledgerDigest(versions) ===
    "85c23142aea5066e8d5236d5b1f2e4d4537e60c0a0980f77c986f7ad45943ab6"
  ) {
    return finalSchemaCatalog(
      JSON.parse(
        readFileSync(
          new URL("./final-schema-628.json", import.meta.url),
          "utf8",
        ),
      ),
      versions,
    );
  }
  if (
    ledgerDigest(versions) ===
    "3d861428d888e0189ecee1dfa4c7410588e77ded4e3e414baa55fbe899b89a40"
  ) {
    return finalSchemaCatalog(
      JSON.parse(
        readFileSync(
          new URL("./final-schema-627.json", import.meta.url),
          "utf8",
        ),
      ),
      versions,
    );
  }
  if (
    ledgerDigest(versions) ===
    "03955edcd6d73e4578398a9a7090413c4c2188c62322c7bb8a08f61ea57907bb"
  ) {
    return finalSchemaCatalog(
      JSON.parse(
        readFileSync(
          new URL("./final-schema-626.json", import.meta.url),
          "utf8",
        ),
      ),
      versions,
    );
  }
  if (
    ledgerDigest(versions) ===
    "2d3efdd65cdbc42b28fc6febc9a21a7fc59b6eb0aad3852e26ec03632ee5653d"
  ) {
    return finalSchemaCatalog(
      JSON.parse(
        readFileSync(
          new URL("./final-schema-625.json", import.meta.url),
          "utf8",
        ),
      ),
      versions,
    );
  }
  const ledgerHash = createHash("sha256")
    .update(versions.join("\n"))
    .digest("hex");
  if (
    versions.length === 622 &&
    ledgerHash ===
      "271ea2171a799dc185d1bd99b5ca215a5180b1c50628b6e3189dede4abe5c48b"
  )
    return cronHistoryCatalog(
      acceptedCatalogQuery(source, versions.slice(0, 621)),
    );
  if (
    versions.length === 621 &&
    ledgerHash ===
      "b8820efee0fc1722aed985f9f3f02ad96399d9a39f883790b0d187c934b2845f"
  )
    return csf621Catalog(acceptedCatalogQuery(source, versions.slice(0, 620)));
  if (
    versions.length === 620 &&
    ledgerHash ===
      "e268153d94400614684d5d3065ae0e05931ada50b0549d9346fb5447758f9f8c"
  )
    return csf620Catalog(
      reconcileCsf620SupersededStorageChecks(
        acceptedCatalogQuery(source, versions.slice(0, 619)),
      ),
    );
  if (
    versions.length === 619 &&
    ledgerHash ===
      "02e506be80a346b3d9343513ffed058b9f7938ee7b1a981470447f79910dddbd"
  )
    return csf619Catalog(acceptedCatalogQuery(source, versions.slice(0, 618)));
  if (
    versions.length === 618 &&
    ledgerHash ===
      "b62315f619e5275d7fe08840e9010112e534e0cd4eba493ba498b0b8b212a16c"
  )
    return csf618Catalog(acceptedCatalogQuery(source, versions.slice(0, 617)));
  if (
    versions.length === 617 &&
    ledgerHash ===
      "87f7793acb06135aba76cc71d59027c46ac68e780db751ffa0f2c6e886b95068"
  )
    return csf617Catalog(acceptedCatalogQuery(source, versions.slice(0, 616)));
  if (
    versions.length === 616 &&
    ledgerHash ===
      "e90356a42a8fb1ec429c9e74dff71e508da8fccad1f05e82776f9535c5a8d78d"
  )
    return csf616Catalog(acceptedCatalogQuery(source, versions.slice(0, 615)));
  if (
    versions.length === 615 &&
    ledgerHash ===
      "5d7ddb1682e3c51dea087b9aab09c51522573720282909cab84b21d39b5de69d"
  )
    return csf615Catalog(acceptedCatalogQuery(source, versions.slice(0, 614)));
  if (
    versions.length === 614 &&
    ledgerHash ===
      "153061ddcc830f8a2ef70c14b6c0655bd1efae0b3d40a39e42d13516a4865def"
  )
    return csf614Catalog(acceptedCatalogQuery(source, versions.slice(0, 613)));
  if (
    versions.length === 613 &&
    ledgerHash ===
      "939603f0d496a7a7fde6e68c54755b974ebace816645dbe84417912dd95faffd"
  )
    return csf613Catalog(acceptedCatalogQuery(source, versions.slice(0, 612)));
  if (
    versions.length === 612 &&
    ledgerHash ===
      "7927d7249742cf633ad5e7eaba8358ed9a7a39d31b208e4ba30c5f66e2bce878"
  )
    return csf612Catalog(acceptedCatalogQuery(source, versions.slice(0, 611)));
  if (
    versions.length === 611 &&
    ledgerHash ===
      "0f3f9ddec15d91f63e7ed8893617a82eeb4c7befacf44a48c986ac75c93e74aa"
  )
    return acceptedCatalogQuery(source, versions.slice(0, 610));
  if (
    versions.length === 610 &&
    ledgerHash ===
      "90222c4a9ebfaf8c250571bfabb1626ab97d0b9c3cc6e5cc7dc9100cd7e73822"
  )
    return csf611Catalog(acceptedCatalogQuery(source, versions.slice(0, 609)));
  if (
    versions.length === 609 &&
    ledgerHash ===
      "b63dfff4d54335dc08e7d2fd0758f27595c0b3f79cd8d58ba3196d66c2717955"
  )
    return csf610Catalog(acceptedCatalogQuery(source, versions.slice(0, 608)));
  if (
    versions.length === 608 &&
    ledgerHash ===
      "55c7eaeb5cbcce556ef780efcaadb0a9cf12e0ae23df6e575f872152846845c0"
  )
    return csf609Catalog(acceptedCatalogQuery(source, versions.slice(0, 607)));
  if (
    versions.length === 607 &&
    ledgerHash ===
      "56e1ac9e7efcc679fa90af7fe6de0f576605cfff521ad34064ba88fb06659273"
  )
    return csf608Catalog(acceptedCatalogQuery(source, versions.slice(0, 606)));
  if (
    versions.length === 606 &&
    ledgerHash ===
      "dd11334a4ba959187e6d6309010ecf29e5dff28a1151e51032c42c7fecaa717b"
  )
    return csf607Catalog(acceptedCatalogQuery(source, versions.slice(0, 605)));
  if (
    versions.length === 605 &&
    ledgerHash ===
      "a45acfd2dc0ebf349f446b1d2698dd1e6a5ae273ef480b2ab22cb0a3940333ac"
  )
    return csf606Catalog(acceptedCatalogQuery(source, versions.slice(0, 604)));
  if (
    versions.length === 604 &&
    ledgerHash ===
      "b816107d78196a8b5f1a5cc1079324d495c1c49bce236deabdaf164b6a34214b"
  )
    return csf605Catalog(acceptedCatalogQuery(source, versions.slice(0, 603)));
  if (
    versions.length === 603 &&
    ledgerHash ===
      "2b08b0903ece881d864054ffa9aa211a95b974d8603f35ce313bb4e98367ef41"
  )
    return csf604Catalog(acceptedCatalogQuery(source, versions.slice(0, 602)));
  if (
    versions.length === 602 &&
    ledgerHash ===
      "05d799198504999960f09e4c123dd42f66fec11a94680c2bd02aabe43579fd8e"
  )
    return csf603Catalog(acceptedCatalogQuery(source, versions.slice(0, 601)));
  if (
    versions.length === 601 &&
    ledgerHash ===
      "d7fee7af89a3e7a983b49ad328dc3a52cae5218eaca6dab1e9faaabfa4a1969d"
  )
    return csf602Catalog(acceptedCatalogQuery(source, versions.slice(0, 600)));
  if (
    versions.length === 600 &&
    ledgerHash ===
      "71e18e1e4e2971fad2b04a114376040b19c688579726da985d566db06975b4ad"
  )
    return csf600Catalog(acceptedCatalogQuery(source, versions.slice(0, 599)));
  if (
    versions.length === 599 &&
    ledgerHash ===
      "5889110aa4f99d3cea5ade80054728aa3bdb5e8b8ab0c99101e2189e2e5e1b6f"
  )
    return csf599Catalog(acceptedCatalogQuery(source, versions.slice(0, 598)));
  if (
    versions.length === 598 &&
    ledgerHash ===
      "d8731f06e57c65d7585a141d02b4484b35c414247707cff92abef45dbbc35877"
  )
    return csf598Catalog(acceptedCatalogQuery(source, versions.slice(0, 597)));
  if (
    versions.length === 597 &&
    ledgerHash ===
      "2ab194e5950c7347ff756a3e338aada7d0de86820676f14e06bf17bd5c92465d"
  )
    return csf597Catalog(acceptedCatalogQuery(source, versions.slice(0, 596)));
  if (
    versions.length === 596 &&
    ledgerHash ===
      "f6a3b30dd7e3769e1fde7895fb0717d3e05a478fe13c7c592e789d3f325ce609"
  )
    return csf596Catalog(acceptedCatalogQuery(source, versions.slice(0, 595)));
  if (
    versions.length === 595 &&
    ledgerHash ===
      "bab9312eb38125d9ca7d7bd40f7567334f76acbaa9a73006b07591e8e3647269"
  )
    return csf595Catalog(acceptedCatalogQuery(source, versions.slice(0, 594)));
  if (
    versions.length === 594 &&
    ledgerHash ===
      "42e5cf40c048a21ef79a4ac8ad693c6b4660d7ec6ccc7baf88ee2abc6fb0f507"
  )
    return csf594Catalog(acceptedCatalogQuery(source, versions.slice(0, 593)));
  if (
    versions.length === 593 &&
    ledgerHash ===
      "d4b094626b437eb2f351b8f5353f9d265a461baf7a5413a34e2fe77cc3088f37"
  )
    return csf593Catalog(acceptedCatalogQuery(source, versions.slice(0, 592)));
  if (
    versions.length === 592 &&
    ledgerHash ===
      "d458c9d0f6736acb93e97ae5fc6a742133e70c3741d9940a2aceef00acfed548"
  )
    return csf592Catalog(acceptedCatalogQuery(source, versions.slice(0, 591)));
  if (
    versions.length === 591 &&
    ledgerHash ===
      "99b6a9aed306c590f34d3067bbc32fdd692cc55ebbd0eebe09f48889eb1df135"
  )
    return csf591Catalog(acceptedCatalogQuery(source, versions.slice(0, 590)));
  if (
    versions.length === 590 &&
    ledgerHash ===
      "cc5d8f0554fe07bc0141e1284021f9eaf4f44473e9a4c1d0f43514c29ca54292"
  )
    return csf590Catalog(acceptedCatalogQuery(source, versions.slice(0, 589)));
  if (
    versions.length === 589 &&
    ledgerHash ===
      "8f48a47ce1a6e08db56a56e38822e540f536f1a2117c4cddbf4f782caf9b3d92"
  )
    return csf589Catalog(acceptedCatalogQuery(source, versions.slice(0, 588)));
  const csf588Ledgers = new Map([
    [583, "bd9438d7d5cf9b8946c32261ccd83427056fbfd12558d5fedb984845a3558182"],
    [584, "5c23de4dcdeac676f9c8ceceed65930308de1b18cf2bc1150850d1cb36d8cdcf"],
    [585, "ae18ae341c5329812bac41dc63058f6ab04d29fd8984ad5df0a25bb2406c45f6"],
    [586, "4a624c33af08890ed02305cb11dcdc516ee0182575609ac050994e3c9a1682d1"],
    [587, "b704815549ceaefcf2f1e74c4bb8d771115cc9d4b4915f65e067b97748db547b"],
    [588, "58b13152c3ce5fe666c2995f760bcc52806ec9698fc0ea687fa246b6eac1510e"],
  ]);
  if (csf588Ledgers.get(versions.length) === ledgerHash) {
    if (versions.length < 588)
      return acceptedCatalogQuery(
        source,
        versions.slice(0, versions.length - 1),
      );
    return csf588Catalog(
      acceptedCatalogQuery(source, versions.slice(0, 587)),
      workerRelationSnapshotQuery,
    );
  }
  if (
    versions.length === 582 &&
    ledgerHash ===
      "be7128ad34d0854a75f7d1b94cc4f8ffa3120b28169cb3b73961bb3495f01a78"
  ) {
    const previous = acceptedCatalogQuery(source, versions.slice(0, 581));
    return `SELECT CASE WHEN (${previous.trim().replace(/;$/u, "")})=1
      AND EXISTS (
        SELECT 1 FROM pg_index
        WHERE indexrelid=to_regclass('plugin_data.csf_dues_records_profile_term_latest_idx')
          AND indisvalid AND indisready AND NOT indisunique
          AND pg_get_indexdef(indexrelid)='CREATE INDEX csf_dues_records_profile_term_latest_idx ON plugin_data.csf_dues_records USING btree (organization_id, profile_id, term_id, updated_at DESC, id DESC) INCLUDE (status)'
      ) THEN 1 ELSE 0 END AS csf_target_schema_verified;`;
  }
  if (
    versions.length === 581 &&
    ledgerHash ===
      "80ddb17ee1ca0ab40040b3223c8bffe978552386b34c7e819061aa71e7fd7e42"
  ) {
    const previous = acceptedCatalogQuery(source, versions.slice(0, 580));
    return semesterLedgerAuthorityCatalog(
      previous
        .replaceAll(
          "74b7a44aa7551dc5d2ada9fde7c40674",
          "e8790bf64057b8bef76c691a7a3c852d",
        )
        .replaceAll(
          "4a013faa20065d7e620c1088900c4faf",
          "cbecc31831fe84c303a2941b59c01516",
        )
        .replaceAll(
          "6d44d27f039ccd271c868e7aa72f6635",
          "84df907f4eb3e77edb675ad7b57fffd9",
        )
        .replaceAll(
          "7ce8fd6421c75a9a19ef3014e4998f5b",
          "a3769fe20a17380a403737ac5511f7a1",
        )
        .replaceAll(
          "45766bcd4803ef8cbd7d4605f7744b47",
          "294c8d521ae3724d5561b619f60b3d49",
        )
        .replaceAll(
          "5c99b2d7923d08d11466dc58e5524211",
          "bed09085445ef97e0a34f0bab63e3828",
        )
        .replaceAll(
          "BEFORE DELETE OR UPDATE OF profile_id, revoked_at ON plugin_data.csf_reviewed_workbook_profile_links",
          "BEFORE DELETE OR UPDATE ON plugin_data.csf_reviewed_workbook_profile_links",
        ),
    );
  }
  if (
    versions.length === 580 &&
    ledgerHash ===
      "7cb7d9f5d9cdc2f5ad67022b3864498225634f06913059d08f1239b0a1cda27e"
  ) {
    const previous = acceptedCatalogQuery(source, versions.slice(0, 579));
    return semesterLedgerMergeClaimCatalog(
      swapAcceptedFingerprints(previous, [
        {
          object: "semester ledger merge-serialized claim",
          before: "1f68ca7ff0fb2a7725413c79d3b01436",
          after: "1e4e11d23ea344399b5ec31195615abf",
          occurrences: 2,
        },
      ]),
    );
  }
  if (
    versions.length === 579 &&
    ledgerHash ===
      "1f24291b4b8da9f226a20cf877422351d7ae2553c965404491d211bd03d53ff6"
  ) {
    const previous = acceptedCatalogQuery(source, versions.slice(0, 578));
    return semesterLedgerRecoveryCatalog(
      swapAcceptedFingerprints(previous, [
        {
          object: "semester ledger workbook-link guard",
          before: "681310b4b440be1ed2fe8ff92baabbb9",
          after: "5c99b2d7923d08d11466dc58e5524211",
          occurrences: 1,
        },
        {
          object: "expired semester ledger reconciliation",
          before: "f43d2748697aefbe585cb17b7f12dcd8",
          after: "dd5cb6c71170301102123cd714157921",
          occurrences: 1,
        },
        {
          object: "reviewed workbook link delete and revocation trigger",
          before: "7f155424a42dd0f6fe01fd911404f843",
          after: "4a013faa20065d7e620c1088900c4faf",
          occurrences: 1,
        },
        {
          object: "semester ledger non-aborted receipt index",
          before: "ca122abe411c0d622a3267d67c91656a",
          after: "7ce8fd6421c75a9a19ef3014e4998f5b",
          occurrences: 2,
        },
      ]),
    );
  }
  if (
    versions.length === 578 &&
    ledgerHash ===
      "23ea816e5914264695361e683b7daf18e831822b03febadcd9be7e1dd63372a6"
  ) {
    const previous = acceptedCatalogQuery(source, versions.slice(0, 577));
    return semesterLedgerClaimIdentityCatalog(
      swapAcceptedFingerprints(previous, [
        {
          object: "semester ledger claim identity",
          before: "c36579ace2984906abb4fc59dc469d50",
          after: "1f68ca7ff0fb2a7725413c79d3b01436",
          occurrences: 1,
        },
      ]),
      "1f68ca7ff0fb2a7725413c79d3b01436",
    );
  }
  if (
    versions.length === 577 &&
    ledgerHash ===
      "fa3eddbf677bfd66e94c7d95d075f8aa73dcafaf640ea8b6e2fd023c5ae86173"
  ) {
    const previous = acceptedCatalogQuery(source, versions.slice(0, 576));
    return semesterLedgerReconciliationCatalog(
      swapAcceptedFingerprints(previous, [
        {
          object: "semester ledger immutable guard",
          before: "d0d9a05b0c292c7ff0552bd891dd9d62",
          after: "e2559b6efb22a87d5dda62651f56f95f",
          occurrences: 1,
        },
        {
          object: "profile merge unsettled-write preview",
          before: "eabcc76e3e61eea9bcd91a6487b10c20",
          after: "b036b5c1b32f812b9f43fd23995b0fa8",
          occurrences: 1,
        },
        {
          object: "semester ledger write relation with ownership trigger",
          before: "47ab6207ab62d8ab7970670627b47f59",
          after: "ca122abe411c0d622a3267d67c91656a",
          occurrences: 2,
        },
        {
          object: "reviewed workbook links with unsettled-write trigger",
          before: "26e1961c0e127c76250c5a81f689c758",
          after: "7f155424a42dd0f6fe01fd911404f843",
          occurrences: 1,
        },
      ]),
    );
  }
  if (
    versions.length === 576 &&
    ledgerHash ===
      "e3c2e15ceb0d22ec4c1324a3a2f51268e346bc18296ad322598ad5b0983c1e1c"
  ) {
    let previous = acceptedCatalogQuery(source, versions.slice(0, 573));
    previous = swapAcceptedFingerprints(previous, [
      {
        object: "publication notice authorization",
        before: "f494ecf0746444bbb55bf2605123ab2a",
        after: "8f8b113fd372dfe7b94ab2c26ca8708e",
        occurrences: 1,
      },
      {
        object: "semester ledger merge reference plan",
        before: "48a500ad4960c56dffca1cf1a823d3ad",
        after: "86ffad9d7360ad5b970528949b66454e",
        occurrences: 1,
      },
    ]);
    return noticeLedgerCatalog(previous, 576, workerRelationSnapshotQuery);
  }
  if (
    versions.length === 575 &&
    ledgerHash ===
      "bc0ebdb840a6c8c5fed3e61724d317d054038c8b8a4e38ab3d1e28895d412feb"
  ) {
    let previous = acceptedCatalogQuery(source, versions.slice(0, 573));
    previous = swapAcceptedFingerprints(previous, [
      {
        object: "publication notice authorization",
        before: "f494ecf0746444bbb55bf2605123ab2a",
        after: "8f8b113fd372dfe7b94ab2c26ca8708e",
        occurrences: 1,
      },
    ]);
    return noticeLedgerCatalog(previous, 575, workerRelationSnapshotQuery);
  }
  if (
    versions.length === 574 &&
    ledgerHash ===
      "5eee4be52342c22b831aed6939929f59c0418b3c429593e175c773c2eb14b3af"
  ) {
    let previous = acceptedCatalogQuery(source, versions.slice(0, 573));
    previous = swapAcceptedFingerprints(previous, [
      {
        object: "publication notice authorization",
        before: "f494ecf0746444bbb55bf2605123ab2a",
        after: "8f8b113fd372dfe7b94ab2c26ca8708e",
        occurrences: 1,
      },
    ]);
    return noticeLedgerCatalog(previous, 574, workerRelationSnapshotQuery);
  }
  if (
    versions.length === 573 &&
    ledgerHash ===
      "5a734a0d4bc920b96f3d6c479499383fe3da6e2a79315e26c9c82cf74bc93bf7"
  ) {
    const preceding = acceptedCatalogQuery(source, versions.slice(0, 572))
      .trim()
      .replace(/;$/u, "");
    return `SELECT CASE WHEN (${preceding}) = 1 AND NOT EXISTS (
      SELECT 1 FROM (VALUES
        ('plugin_data.csf_officer_save_profile_activity(uuid,uuid,uuid,uuid,text,text,numeric,timestamptz,text,uuid,uuid,boolean)', 'f4e9f791a741a384b600da27d75a692a'),
        ('plugin_data.csf_officer_delete_profile_activity(uuid,uuid,uuid,text,uuid,uuid,boolean)', '15c473243b63716af2e192246526c4e4')
      ) AS expected(signature, definition_hash)
      LEFT JOIN pg_catalog.pg_proc AS p ON p.oid = pg_catalog.to_regprocedure(expected.signature)
      WHERE p.oid IS NULL OR md5(pg_catalog.pg_get_functiondef(p.oid)) IS DISTINCT FROM expected.definition_hash
        OR NOT p.prosecdef OR p.proowner <> 'postgres'::regrole
        OR has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
        OR NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
        OR NOT has_function_privilege('postgres', p.oid, 'EXECUTE')
    ) THEN 1 ELSE 0 END AS csf_target_schema_verified;`;
  }
  if (
    versions.length === 572 &&
    ledgerHash ===
      "0fdd58d9380c7b5cc9a1ef99285774b16fc1e158c644a3635ff6e240a01ae5bc"
  ) {
    const preceding = acceptedCatalogQuery(source, versions.slice(0, 571));
    const before = "17bfb459fed6fa6e07b22d67e45431b7";
    if (preceding.split(before).length !== 2) {
      throw new ReleaseCheckError(
        "The report quota baseline fingerprint is missing or repeated.",
      );
    }
    return preceding.replace(before, "7a6a48303831cd8a94d32f9cb3216631");
  }
  if (
    versions.length === 571 &&
    ledgerHash ===
      "050b0d277b1099eaccd134961a59a96874ef9a587496a3debe440aabb3717961"
  ) {
    const preceding = acceptedCatalogQuery(source, versions.slice(0, 570))
      .trim()
      .replace(/;$/u, "");
    return `SELECT CASE WHEN (${preceding}) = 1 AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS p
      WHERE p.oid = pg_catalog.to_regprocedure('plugin_data.csf_submit_member_report(uuid,uuid,text,text,uuid)')
        AND md5(pg_catalog.pg_get_functiondef(p.oid)) = '17bfb459fed6fa6e07b22d67e45431b7'
        AND p.prosecdef AND p.proowner = 'postgres'::regrole
        AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
        AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
        AND has_function_privilege('service_role', p.oid, 'EXECUTE')
        AND has_function_privilege('postgres', p.oid, 'EXECUTE')
    ) THEN 1 ELSE 0 END AS csf_target_schema_verified;`;
  }
  if (
    versions.length === 570 &&
    ledgerHash ===
      "8cd5c5b8d76142fbd0f1f14f3acbb5a2d6ff3083cbb97f706c253517e1042798"
  ) {
    const preceding = acceptedCatalogQuery(source, versions.slice(0, 569))
      .trim()
      .replace(/;$/u, "");
    return `SELECT CASE WHEN (${preceding}) = 1 AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS p
      WHERE p.oid = pg_catalog.to_regprocedure('plugin_data.csf_unreconcile_sheet_import_row_identity_base(uuid,uuid,uuid,text,uuid)')
        AND md5(pg_catalog.pg_get_functiondef(p.oid)) = '4ca4488557e8c00c2beaebabdcb2fcd3'
        AND p.prosecdef AND p.proowner = 'postgres'::regrole
        AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
        AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
        AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
        AND has_function_privilege('postgres', p.oid, 'EXECUTE')
    ) THEN 1 ELSE 0 END AS csf_target_schema_verified;`;
  }
  if (
    versions.length === 569 &&
    ledgerHash ===
      "2b47451e2fb5331055ecb1c893a6bbfe15879034f9678aceefa30e363cee8fd1"
  ) {
    const preceding = acceptedCatalogQuery(source, versions.slice(0, 568))
      .trim()
      .replace(/;$/u, "");
    return `SELECT CASE WHEN (${preceding}) = 1 AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS p
      WHERE p.oid = pg_catalog.to_regprocedure('plugin_data.csf_member_home_context_snapshot(uuid,uuid,timestamptz,timestamptz,date)')
        AND md5(pg_catalog.pg_get_functiondef(p.oid)) = '6e84959ba202168e3bdac4623d93da9b'
        AND p.prosecdef AND p.proowner = 'postgres'::regrole
        AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
        AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
        AND has_function_privilege('service_role', p.oid, 'EXECUTE')
        AND has_function_privilege('postgres', p.oid, 'EXECUTE')
    ) THEN 1 ELSE 0 END AS csf_target_schema_verified;`;
  }
  // Batch undo adds private functions without changing the pinned catalog.
  if (
    versions.length === 568 &&
    ledgerHash ===
      "70246622f8c1035ed5e8109f7bb429ec310e92a34eec2bec99ee6fea2b0208b2"
  )
    return acceptedCatalogQuery(source, versions.slice(0, 567));
  // This forward repair replaces only unpinned retention and attendance helpers.
  if (
    versions.length === 567 &&
    ledgerHash ===
      "bf30bd38bed5090a5ef7ab08160b4ca97c24f7e4cdec3188eac07678feddc004"
  )
    return acceptedCatalogQuery(source, versions.slice(0, 566));
  if (
    versions.length === 566 &&
    ledgerHash ===
      "d1f8a71f2bc95078691f6ff7f3ce56c764c7f13a01160c462f3f9ba9cdd1db95"
  )
    // 1600 gives a personal notice campaign a valid dispatch identity and
    // repairs a legacy draft when its RPC next runs. It restates two functions
    // of the notices lane's own, both verified absent from the generated
    // accepted catalog, and adds no relation, index or trigger. No reviewed
    // fingerprint moves, so the release passes through.
    return acceptedCatalogQuery(source, versions.slice(0, 565));
  if (
    versions.length === 565 &&
    ledgerHash ===
      "d692b51d050b7b2b354fd2720ab2416585985931a08a7f27163ae85c3da8e075"
  )
    return swapAcceptedFingerprints(
      acceptedCatalogQuery(source, versions.slice(0, 557)),
      acceptedFingerprints565,
    );
  if (
    versions.length === 557 &&
    ledgerHash ===
      "512cb507d345054714c396b086a710ede75187d26ec8e60256bea6674ad8575b"
  )
    // The published decision reason restates one RPC of the decisions lane's
    // own so a red mark stops inventing an explanation. It was verified absent
    // from the generated accepted catalog, so no reviewed fingerprint moves.
    return acceptedCatalogQuery(source, versions.slice(0, 556));
  if (
    versions.length === 556 &&
    ledgerHash ===
      "eeb3306cd09682d97c1cff06ea170e3b1f82620847ba974c096a3530717313e5"
  )
    // The ordinal predicate restates one RPC of the decisions lane's own with a
    // safe-update-compatible UPDATE. It was verified absent from the generated
    // accepted catalog, so no reviewed fingerprint moves.
    return acceptedCatalogQuery(source, versions.slice(0, 555));
  if (
    versions.length === 555 &&
    ledgerHash ===
      "b6716c1e6fe25011a6b697b5799b15d531effbd66dc8e15e934ba798cb175cde"
  )
    // The decision plan reset restates two RPCs of the decisions lane's own
    // with a safe-update-compatible clear. Both were verified absent from the
    // generated accepted catalog, so no reviewed fingerprint moves.
    return acceptedCatalogQuery(source, versions.slice(0, 554));
  // Two reachable appends for the class-block acceptance migration, because
  // the officer identity work may land before or after it. Either way this is
  // the previous ledger plus one tail entry.
  if (
    versions.length === 554 &&
    ledgerHash ===
      "45644bd99f53b503cda4d5b8acefcc04d1134be7617abe07fb7fc16c5662a31c"
  )
    // Provenance null safety: a forward replacement of the decisions
    // lane's own functions. No reviewed definition moves.
    return acceptedCatalogQuery(source, versions.slice(0, 553));
  if (
    versions.length === 553 &&
    ledgerHash ===
      "a407752136d1ae818048862d6b9630914036c17009df93fe90aa9c2b77781cd0"
  )
    // finalized outcome guard: new relations, guards and entrypoints of their own.
    // No reviewed definition moves, so the catalog passes through.
    return acceptedCatalogQuery(source, versions.slice(0, 552));
  if (
    versions.length === 552 &&
    ledgerHash ===
      "3f991eb00f76eaa872018e2e5c1dbff8822e8f60c8ded255facf559db4cfc95f"
  )
    // application decision mapping fields: new relations, guards and entrypoints of their own.
    // No reviewed definition moves, so the catalog passes through.
    return acceptedCatalogQuery(source, versions.slice(0, 551));
  if (
    versions.length === 551 &&
    ledgerHash ===
      "c407d682c92005ee9706436350e8f5e09ccdbb6adc22a1bbf35fe0b9504f2cf1"
  )
    // 20260917020000 re-layers the five-argument merge and its plan.
    return decisionMergeOwnershipCatalog(
      acceptedCatalogQuery(source, versions.slice(0, 550)),
    );
  if (
    versions.length === 550 &&
    ledgerHash ===
      "a8db68bd95b10cbeb4631db003f783a90398d224bade8cdc91ecb3d45995a4ad"
  )
    // sheet application decision release: new relations, guards and entrypoints of their own.
    // No reviewed definition moves, so the catalog passes through.
    return acceptedCatalogQuery(source, versions.slice(0, 549));
  if (
    versions.length === 549 &&
    ledgerHash ===
      "00b48e8de6ecd58568200dad0415b4eb9a259ba3592ef6fd6fc0a440d09660e3"
  )
    // sheet application decision sync: new relations, guards and entrypoints of their own.
    // No reviewed definition moves, so the catalog passes through.
    return acceptedCatalogQuery(source, versions.slice(0, 548));
  if (
    versions.length === 548 &&
    ledgerHash ===
      "26a71fa57c752ea0255592d1d23fcef46412570c59d3822a41225a4121005fa3"
  )
    // sheet application decision RPCs: new relations, guards and entrypoints of their own.
    // No reviewed definition moves, so the catalog passes through.
    return acceptedCatalogQuery(source, versions.slice(0, 547));
  if (
    versions.length === 547 &&
    ledgerHash ===
      "97eac1a6fda372015990d3207e8b739700e4cde5f91fb4b252f8bb910b38bf28"
  )
    // 20260917010000 moves csf_terms and csf_sheet_writeback_ledger.
    return decisionStagingRelationCatalog(
      acceptedCatalogQuery(source, versions.slice(0, 546)),
    );
  if (
    versions.length === 546 &&
    ledgerHash ===
      "6460ad835f21b27ce24e28cdb5cc93654503ca3462fc961c74cfa0390412673b"
  )
    // 20260916090000 rewires the officer connection onto the shared
    // supersede, moving that body a second time in this release.
    return decisionSupersedeCatalog(
      acceptedCatalogQuery(source, versions.slice(0, 545)),
    );
  if (
    versions.length === 545 &&
    ledgerHash ===
      "9758bd44e5d741e993fd92498df6bca69e511b2e762b1766894b78ee2de5d4d6"
  )
    // officer edit review fixes: new relations, guards and entrypoints of their own.
    // No reviewed definition moves, so the catalog passes through.
    return acceptedCatalogQuery(source, versions.slice(0, 544));
  if (
    versions.length === 544 &&
    ledgerHash ===
      "1b2639267c001a61f9c13d964323e2abb3383ce77785fda854418fe58d406575"
  )
    // 20260916070000 moves both sheet acceptance definitions and bodies.
    return classBlockAcceptanceCatalog(
      acceptedCatalogQuery(source, versions.slice(0, 543)),
    );
  if (
    versions.length === 543 &&
    ledgerHash ===
      "53eb05c8b70ec491e20007b6815cde84e6bce056a668bea94fe6e9b3ecf4a64a"
  )
    // 20260916060000 indexes csf_admin_audit_events, moving its relation
    // digest. Measured, not inferred.
    return officerActivityRelationCatalog(
      acceptedCatalogQuery(source, versions.slice(0, 542)),
    );
  if (
    versions.length === 542 &&
    ledgerHash ===
      "8c9cb7fcf678bf07c08d5123dd7607f620319ebabff0cc69cd330f768e91cf8e"
  )
    // The closed-evidence guard keeps its reviewed shape and carries no
    // reviewed fingerprint of its own, so the catalog is unchanged.
    return acceptedCatalogQuery(source, versions.slice(0, 541));
  if (
    versions.length === 541 &&
    ledgerHash ===
      "f60cfebd893b0fe0d32979592cdc8e55f7656a9d15a27387d0f49b50a7029d25"
  )
    // csf_meeting_attendance_value is owner-internal and carries no
    // reviewed fingerprint, so this release leaves the catalog untouched.
    return acceptedCatalogQuery(source, versions.slice(0, 540));
  if (
    versions.length === 540 &&
    ledgerHash ===
      "7cbbdeea1274e00b99f18c281fac657585bb634574565046c88d8cdc131dac44"
  )
    return officerIdentityAuthorityCatalog(
      acceptedCatalogQuery(source, versions.slice(0, 539)),
    );
  if (
    versions.length === 539 &&
    ledgerHash ===
      "8d32e6a3d05883f41394d0960b847dbf8cfa53228b175733320436e16e04c4f2"
  )
    return acceptedCatalogQuery(source, versions.slice(0, 538));
  if (
    versions.length === 538 &&
    ledgerHash ===
      "341af96093ff350a31d62a9b51a7c43255bd98796f6efe19fbc6a837740addf7"
  )
    return acceptedCatalogQuery(source, versions.slice(0, 537));
  if (
    versions.length === 537 &&
    ledgerHash ===
      "31520d05057979697730967024dc28fec3611efa511bb31975b8935a21bb4ede"
  )
    return acceptedCatalogQuery(source, versions.slice(0, 536));
  if (
    versions.length === 536 &&
    ledgerHash ===
      "5756a8f9d315f6c39b2769e713b70acb96a0194e2418da800586651f35d95456"
  )
    return acceptedCatalogQuery(source, versions.slice(0, 535));
  if (
    versions.length === 535 &&
    ledgerHash ===
      "dcf923637e5b2e3a17c367ae6fe07970cd5abb346837fea27e3b17b79e58dc88"
  )
    return resolvedClassRecoveryCatalog(
      acceptedCatalogQuery(source, versions.slice(0, 534)),
    );
  if (historyIdentityLedgers.get(versions.length) === ledgerHash)
    return historyIdentityCatalog(
      acceptedCatalogQuery(source, versions.slice(0, 530)),
    );
  if (
    versions.length === 444 &&
    ledgerHash ===
      "34dbbd884882349f8083512cd2fe48b371c3f1242bc62897685267f2a5d0001b"
  )
    return source;
  const publicationWorkerControlUpgrade =
    (versions.length === 530 &&
      ledgerHash ===
        "35918aca6fdc7ed30bb7798dedf31c94b03347b01e6ff63317fb14cb6f66a378") ||
    (versions.length === 529 &&
      ledgerHash ===
        "9cc45cfaa4eaed830bedae091038c426c4aa844791fc14da536723c9966a27db") ||
    (versions.length === 528 &&
      ledgerHash ===
        "f3355102be80853a9bbe0af414d96c2d6a8bec18a7709a69387e8bba21a96cb6") ||
    (versions.length === 527 &&
      ledgerHash ===
        "9d4c66b1b2fdc294f42c974e057220e61b86c4c5bb3a912528b2c502a24b69bf") ||
    (versions.length === 526 &&
      ledgerHash ===
        "850a49d424accb447337d5581f43b413632d2a52ec5fa2b7405be716ed997dd5") ||
    (versions.length === 525 &&
      ledgerHash ===
        "a74aba1e81d9263b1261e64617b2d5b263294f3a4f1b6d1afacaa51be5d53f01") ||
    (versions.length === 524 &&
      ledgerHash ===
        "87b0f51676909c779ecf7a39dcae3e0086abb150fe688f3f02716091ce8af921") ||
    (versions.length === 523 &&
      ledgerHash ===
        "7ecc52d357c6bebbddb7dbf2f6cf888aa51623777ad6c1e46d3d38984fb0ee7b") ||
    (versions.length === 522 &&
      ledgerHash ===
        "672bb586c1684a49c5f3eee9fb908592243d207e427a0d6bde05aa768b8a1c90") ||
    (versions.length === 518 &&
      ledgerHash ===
        "5d28518bb641b71b1e4842783183fbf48905143ae11254443466809ecabeefcd") ||
    (versions.length === 517 &&
      ledgerHash ===
        "3db94e138a5ef8978ab54bf52553890cb0049d66b9d3626919e3d417f9de9802") ||
    (versions.length === 516 &&
      ledgerHash ===
        "dc7187711012f9086d906fdb29cce727962e70b2b1ae83db9a4833db469bb8c4") ||
    (versions.length === 515 &&
      ledgerHash ===
        "c98dd3faf7a10c9ac190da27a1612db73635b493a9b8eb16f0d40a2905104eba");
  const publicationNotificationsUpgrade =
    publicationWorkerControlUpgrade ||
    (versions.length === 514 &&
      ledgerHash ===
        "16ef394ea1f8e7cafc7a9c0adb6c15beea62345ccbdd5948b965a53d88017cb4");
  const sheetDiscussionWriteUpgrade =
    publicationNotificationsUpgrade ||
    (versions.length === 513 &&
      ledgerHash ===
        "0c6a00172f433c965ae4d8e5bc267dad72f3b88292e74479b95df16b6eedef7b") ||
    (versions.length === 512 &&
      ledgerHash ===
        "8879a1ccdd7b952fdb4cf80539d22dbebc65e9c55e557d2dd636ce846d315007") ||
    (versions.length === 511 &&
      ledgerHash ===
        "6db6ffb66313b404bb77363ac09177be3bf6b72578390d9db6b0b99b5f1f253e");
  const activityUndatedLifecycleUpgrade =
    sheetDiscussionWriteUpgrade ||
    (versions.length === 510 &&
      ledgerHash ===
        "01fff3ace553725d2794248c62f02c282da0cc95937e10380188169f014a5310") ||
    (versions.length === 509 &&
      ledgerHash ===
        "2f268f391f1de5a1475ab6fbac1bf0b7cb24dac8bae8c7de5033c5f2730c3509") ||
    (versions.length === 508 &&
      ledgerHash ===
        "d4b1d37e9109c93732bfb8052250e96441312435eb672f3a7b2d61ab7cb7ac98") ||
    (versions.length === 507 &&
      ledgerHash ===
        "74c3fd6418f4d8e3ed8b888ffa14916d0c7696cacd0b186ee09d6ded4b3a00bd");
  const activityOptionalStartUpgrade =
    activityUndatedLifecycleUpgrade ||
    (versions.length === 506 &&
      ledgerHash ===
        "3615b1944d718c514af06bc1f581dc5e20ba18eddb8b520274af8346d4fb5fe5") ||
    (versions.length === 505 &&
      ledgerHash ===
        "8eae73e44b1689395484f184250c107d4e04cfc710264b59242301deca8e64d5");
  const mergedSourceLineageUpgrade =
    activityOptionalStartUpgrade ||
    (versions.length === 504 &&
      ledgerHash ===
        "c8cae9edc23dc1677ad2febd452834d1cf812b9cca07de7d0dbb0604cd49b655");
  const memberDirectorySearchUpgrade =
    mergedSourceLineageUpgrade ||
    (versions.length === 503 &&
      ledgerHash ===
        "23077b82cbccecb8e9687470696a558f5174c22e33319d922c053744e3b2138a") ||
    (versions.length === 502 &&
      ledgerHash ===
        "8a58d84f5ea6a470e35ae52e151ed0b221f5a09bfe72c1e53f94cf42f01ac971") ||
    (versions.length === 501 &&
      ledgerHash ===
        "8bcbd4f9b3f227a586147e978b01e099e3a7eedbaca28e32e45795768f03da6a") ||
    (versions.length === 500 &&
      ledgerHash ===
        "ed3947a73f9ae0c2b72b612d03464c699555fd2edc869d01d40f3d7e05a8ada2");
  const sheetNoCommentsUpgrade =
    memberDirectorySearchUpgrade ||
    (versions.length === 499 &&
      ledgerHash ===
        "aa839d1ce9db1d525f66381afc4bfccc37732a2b226c972a088a5d565f800d30");
  const applicationCanonicalRangeUpgrade =
    sheetNoCommentsUpgrade ||
    (versions.length === 498 &&
      ledgerHash ===
        "26dfd00d401675d971d1c0abce0355b9f703091fac77cdb5440341bd9ee1baa2") ||
    (versions.length === 497 &&
      ledgerHash ===
        "3030f0e5b182aaa582577bb54bd27b6f2acada984d8a19e66ca1cd7e5ed84de0");
  const applicationRangeUpgrade =
    applicationCanonicalRangeUpgrade ||
    (versions.length === 496 &&
      ledgerHash ===
        "51549a21b6fb7abad784b889c7c29813f5c568c6fa0011bde52a2dbad37b2258");
  const sheetToggleUpgrade =
    applicationRangeUpgrade ||
    (versions.length === 495 &&
      ledgerHash ===
        "38a1c11bc645983e7ea896499043c81890ee50aa92d1706c42baa0b921851bad") ||
    (versions.length === 494 &&
      ledgerHash ===
        "e359a42486e32924eb5856a55e770ec42faa09601d71f10b32c35cb209b62518");
  const sheetDeferredNoteUpgrade =
    sheetToggleUpgrade ||
    (versions.length === 493 &&
      ledgerHash ===
        "a412156a94951d6a3995011f2f5b27bc336f9ffef0fdff913daf78ac1316f915");
  const sheetObservationUpgrade =
    sheetDeferredNoteUpgrade ||
    (versions.length === 491 &&
      ledgerHash ===
        "4b6c08631b3358bdd6aeeafd2e2c1f2552bd22dd8bafdb09f8cd3f5ed751f6ce") ||
    (versions.length === 492 &&
      ledgerHash ===
        "724a563d57619b24d8d696cb021b98bab2bbef4ed018df863c571c7c1a7065a0");
  const sheetRecoveryUpgrade =
    sheetObservationUpgrade ||
    (versions.length === 489 &&
      ledgerHash ===
        "db08f289c2f648d955c2238108fb8b20b8e71b0a03eec7c5226f741ba05031c6") ||
    (versions.length === 490 &&
      ledgerHash ===
        "8c974cfcfc5c9a7550b2b5ee0926f107cb7af524fd8b4225f87edd945a71c5dc");
  const sheetDiscussionUpgrade =
    sheetRecoveryUpgrade ||
    (versions.length === 487 &&
      ledgerHash ===
        "80f95ab50c493a2759eeb23e17398b992b0b4f2aac6556947f874cb0d616b059") ||
    (versions.length === 488 &&
      ledgerHash ===
        "0d78f8f25b496da867238a8324a19e6cc4dec615337e988660bd9b0e8bf56e16");
  const sheetSyncUpgrade =
    sheetDiscussionUpgrade ||
    (versions.length === 483 &&
      ledgerHash ===
        "4cba941c6304329ccbf4c2ccbd6371d41d235e8e943124d4b73a7b9ab1dfb144") ||
    (versions.length === 484 &&
      ledgerHash ===
        "c54a7e57d7f32caa8757f8defc106df7637984d99943835ee6cb4030fbdf00d8") ||
    (versions.length === 485 &&
      ledgerHash ===
        "8d650ea3d0d0148d14f9e57e1d52b1bd2bd8e8d61a71f4241dc1d59009adfd31") ||
    (versions.length === 486 &&
      ledgerHash ===
        "01316a49d8af843cd146181f8b48d34b0bb68adda381314a90ce8e862c52ff41");
  const revokedHistoryUpgrade =
    sheetSyncUpgrade ||
    (versions.length === 482 &&
      ledgerHash ===
        "67fc11a98fd055dae9620a1424e549c68a476c9ea3b72976adac2884edda9858");
  const ownershipUpgrade =
    revokedHistoryUpgrade ||
    (versions.length === 481 &&
      ledgerHash ===
        "1cf2771bccb68d7e47a8821130724f4d15d4ab526eea466ce2eb057b21689de3");
  const applicationContactsUpgrade =
    ownershipUpgrade ||
    (versions.length === 478 &&
      ledgerHash ===
        "2e81f6ea74cce432a5fc18aa0ff5605b025e71f4bed237b7c079d670dc00c1f6");
  const applicationReviewReopenUpgrade =
    applicationContactsUpgrade ||
    (versions.length === 477 &&
      ledgerHash ===
        "a4e0cc4d257d8fdd71ef5c08d44f7a95a2ffaa432ea368608840d5328322053e");
  const staffAccountAuthorityUpgrade =
    applicationReviewReopenUpgrade ||
    (versions.length === 476 &&
      ledgerHash ===
        "cac848eb296d0e0fddf3edc1702655737a7f428b072ae0ccc6bcbddc2aa52b83");
  const staffAccountConnectionUpgrade =
    staffAccountAuthorityUpgrade ||
    (versions.length === 475 &&
      ledgerHash ===
        "d5e3c7654e92e5875ccc25b79eaf35a75ee6224d1faddd7a1eb95765d0f33ef5");
  const optionalCourseUpgrade =
    staffAccountConnectionUpgrade ||
    (versions.length === 474 &&
      ledgerHash ===
        "9bfb026cdad00b52ea2cce2a2d7a8b1a2d189af295cc1a14c6c7eae600f9416a");
  const reportedCourseUpgrade =
    optionalCourseUpgrade ||
    (versions.length === 473 &&
      ledgerHash ===
        "f517e5044b57d212e06bd449e88c1bf3be878535a57a6d6bb09ad52719f6848f");
  const activeDirectoryUpgrade =
    reportedCourseUpgrade ||
    (versions.length === 472 &&
      ledgerHash ===
        "200e4af50b3765ecb16417eb599b25eda1f7becd40836eec1a5bcc70cb50ba66");
  const archivedDirectoryUpgrade =
    activeDirectoryUpgrade ||
    (versions.length === 471 &&
      ledgerHash ===
        "52d6bf9b2b504ed72459d4787016073800cc0c8791c7ec3f80b0d8c2a64a984e");
  const applicationRetryUpgrade =
    archivedDirectoryUpgrade ||
    (versions.length === 470 &&
      ledgerHash ===
        "122e681fa747cc8895a2733a2d83a9842836a4b764f6810dd03e0a9070e03f66");
  const matchingTabUpgrade =
    applicationRetryUpgrade ||
    (versions.length === 468 &&
      ledgerHash ===
        "3a54205a45fb0b4e9f7fd142d6f15126c64b6801ea4a70f775ec98fc93a0c23e");
  const workbookLinkMergeUpgrade =
    matchingTabUpgrade ||
    (versions.length === 467 &&
      ledgerHash ===
        "409d6d8593990502fbb657e2b6bda8f0a012c7c240846e14f2482eb621adbaf9");
  const automaticSheetUpdatesUpgrade =
    workbookLinkMergeUpgrade ||
    (versions.length === 466 &&
      ledgerHash ===
        "b7935dfecb07b70ca0f07b577af5d218f56a7d54e2c17b4a9385448d6f3b720d");
  const reviewedWorkbookLinksUpgrade =
    automaticSheetUpdatesUpgrade ||
    (versions.length === 465 &&
      ledgerHash ===
        "64e937e5df0bf59426a133456c6c4577df89a140a770613d2636710f62443caa");
  const applicationSourceReviewUpgrade =
    reviewedWorkbookLinksUpgrade ||
    (versions.length === 464 &&
      ledgerHash ===
        "3ad23ec658d856ded84d8c5a66c8f9f6d326ce2b5cc07df77fb8e41b744be524");
  const workbookRecoveryUpgrade =
    applicationSourceReviewUpgrade ||
    (versions.length === 463 &&
      ledgerHash ===
        "ed1c518455ee043feeb78edc6e1c3d567c73d631042699fad5fe0d048f1488d8");
  const requirementEvidenceUpgrade =
    workbookRecoveryUpgrade ||
    (versions.length === 462 &&
      ledgerHash ===
        "cae83251fef7fa7611f89ba03ceea809b6f15d105a68415dd72c5a8151a0f997");
  const schedulingRetirementUpgrade =
    requirementEvidenceUpgrade ||
    (versions.length === 461 &&
      ledgerHash ===
        "a6a6c780914ec9b2bbc8ad461645ea96b8b9d989840f2fbb7aae6e7270e0b8e1");
  const identityPreviewStateUpgrade =
    schedulingRetirementUpgrade ||
    (versions.length === 460 &&
      ledgerHash ===
        "e0a6a89e861dcc74b59dfaec28ac35ddccc9fe3faa5e63934d143c8e98d662a8");
  const canonicalPointUpdateUpgrade =
    identityPreviewStateUpgrade ||
    (versions.length === 459 &&
      ledgerHash ===
        "c7c3c098a7902aefd912130352867529e7f04870ad50a32d90d8d2bd9c0473a3");
  const pointVerificationUpgrade =
    canonicalPointUpdateUpgrade ||
    (versions.length === 458 &&
      ledgerHash ===
        "8d617c8fbc841fbd4910e269261846110105ed1a6a7c0905b3749487b17987a5");
  const annotationReviewStateUpgrade =
    pointVerificationUpgrade ||
    (versions.length === 457 &&
      ledgerHash ===
        "d0bb60abb4c4a7c0984c7f0f777b9515d055acc51cab29aaee36f31737d58fd0");
  const annotationErrorIdentityUpgrade =
    annotationReviewStateUpgrade ||
    (versions.length === 456 &&
      ledgerHash ===
        "0814438288ba61e24d8c3c354d63de123b3a1da4bc300e812a6b236184f330c7");
  const composableReviewUpgrade =
    annotationErrorIdentityUpgrade ||
    (versions.length === 455 &&
      ledgerHash ===
        "2dc071e0cd4d8f48b9a42ca8736f9638a159fb7f39f9755386a06e0606cec844");
  const pendingIdentityUpgrade =
    composableReviewUpgrade ||
    (versions.length === 454 &&
      ledgerHash ===
        "548a33c9dde018e92c04bd7209848cddd108bbbf631bc527faf88959eb8dc8a3");
  const officerAnnotationUpgrade =
    pendingIdentityUpgrade ||
    (versions.length === 453 &&
      ledgerHash ===
        "315087bff5b40d4dba1c6577adc071f886ad25365c3366f4a49e163afd210e48");
  const identityReviewUpgrade =
    officerAnnotationUpgrade ||
    (versions.length === 452 &&
      ledgerHash ===
        "b0d3cef5d332d20877ddcbcee20971a8b3c32b4116ca6269c11bf2325471f3f6");
  const reprepareAuthorityUpgrade =
    identityReviewUpgrade ||
    (versions.length === 451 &&
      ledgerHash ===
        "a3b709dea637acd1fdd4a8820f8b2830be3fb8c53e8d8ab9d9975a8164f41148");
  const compoundSearchUpgrade =
    reprepareAuthorityUpgrade ||
    (versions.length === 450 &&
      ledgerHash ===
        "3837bdabfb7e3d5c7258f00a484516b252c1f6b56880cb2201ec186f9320ee80");
  const reprepareUpgrade =
    compoundSearchUpgrade ||
    (versions.length === 449 &&
      ledgerHash ===
        "e057e1ab6ba2fb32fa73005d9f6c5ff5ee18e86ecbd72c2e19b93f7c8f5e130d");
  const importReviewUpgrade =
    reprepareUpgrade ||
    (versions.length === 448 &&
      ledgerHash ===
        "88ed874e0f578d6b64bd8b7368f8e8c2fa8e11737fc2a20c1469f20379ded445");
  const workerUpgrade =
    versions.length === 446 &&
    ledgerHash ===
      "449fbef149b83293d6c4312ee987b050dc9026aef0a24e9b330a518baf48b7d4";
  if (!workerUpgrade && !importReviewUpgrade)
    throw new ReleaseCheckError(
      "This claim catalog version needs explicit release review.",
    );
  const start = source.indexOf(
    "expected_function_fragments(signature, definition_fragment) AS (",
  );
  const end = source.indexOf("function_fragment_posture AS (", start);
  const signature =
    "'plugin_data.csf_revalidate_class_code_connection_replay(uuid,uuid,uuid,uuid,jsonb)'";
  const legacy =
    "'plugin_data.csf_revalidate_class_code_connection_replay_legacy(uuid,uuid,uuid,uuid,jsonb)'";
  const fragments = source.slice(start, end);
  if (start < 0 || end < start || fragments.split(signature).length !== 3)
    throw new ReleaseCheckError(
      "The accepted catalog fragment contract changed.",
    );
  let upgradedFragments = fragments.replaceAll(signature, legacy);
  if (ownershipUpgrade) {
    const confirmation =
      "'plugin_data.csf_confirm_class_code_account_name_match(uuid,uuid,uuid,text,uuid,uuid,text,text,text)'";
    for (const [before, after] of [
      ["if v_email is null then", "code.cohort_id = p_cohort_id"],
      [
        "v_result := plugin_data.csf_join_class_by_code_identity_base(",
        "return plugin_data.csf_join_class_by_code(",
      ],
      [
        "return plugin_data.csf_revalidate_class_code_connection_replay(",
        "coalesce(p_profile_id,",
      ],
    ]) {
      const previous = `${confirmation},\n      '${before}'`;
      if (upgradedFragments.split(previous).length !== 2)
        throw new ReleaseCheckError(
          "The confirmation fragment contract changed.",
        );
      upgradedFragments = upgradedFragments.replace(
        previous,
        `${confirmation},\n      '${after}'`,
      );
    }
  }
  const adjusted =
    source.slice(0, start) + upgradedFragments + source.slice(end);
  const marker = "SELECT 1 / CASE\n";
  const gate = "WHEN (SELECT valid FROM table_posture)";
  if (adjusted.split(marker).length !== 2 || adjusted.split(gate).length !== 2)
    throw new ReleaseCheckError(
      "The accepted catalog result contract changed.",
    );
  const baseDefinitions = importReviewUpgrade
    ? [...acceptedDefinitions, ...importReviewDefinitions]
    : acceptedDefinitions;
  const definitions = pendingIdentityUpgrade
    ? baseDefinitions.filter(
        ([signature]) =>
          signature !==
          "plugin_data.csf_reconcile_sheet_import_row_identity_base(uuid,uuid,uuid,text,text,uuid,uuid,jsonb)",
      )
    : baseDefinitions;
  if (ownershipUpgrade) {
    for (const originalDefinition of ownershipDefinitions) {
      const definition = [...originalDefinition];
      if (
        revokedHistoryUpgrade &&
        definition[0] ===
          "plugin_data.csf_join_class_by_code_identity_base(uuid,text,uuid,text,text,text,text,uuid,uuid)"
      )
        definition[1] = "2c3ed2e24bee1d590dfedd62c27bb75c";
      const index = definitions.findIndex(
        ([signature]) => signature === definition[0],
      );
      if (index === -1) definitions.push(definition);
      else definitions[index] = definition;
    }
  }
  if (pointVerificationUpgrade)
    definitions.push([
      "plugin_data.csf_enforce_point_submission_freeze()",
      "932eae452025dfd57e24d644b441aea4",
      false,
    ]);
  if (schedulingRetirementUpgrade) {
    const setter = definitions.find(
      (item) =>
        item[0] ===
        "app_private.set_csf_release_worker_control(text,text,boolean,bigint,uuid,text,text)",
    );
    if (!setter)
      throw new ReleaseCheckError("Worker control catalog entry is missing.");
    const index = definitions.indexOf(setter);
    definitions[index] = [setter[0], "91318f5b00c40c30b9be7a36a08c5109", false];
    definitions.push(
      [
        "app_private.retire_csf_scheduled_posts()",
        "6e08e34639831cc8d178d1363c91fa61",
        false,
      ],
      [
        "plugin_data.csf_guard_announcement_schedule_lifecycle()",
        "af351b0c18cd5a9fa1c333dd9502c58d",
        false,
      ],
      [
        "plugin_data.csf_publish_due_posts(integer,text)",
        "bd1c22ec097dab0f168b93ef6d5581a8",
        true,
      ],
      [
        "plugin_data.csf_mutate_post(uuid,text,uuid,jsonb,uuid,uuid)",
        "9dee34bed53f2c27f2b80b7ddafbfcbf",
        true,
      ],
    );
  }
  if (archivedDirectoryUpgrade)
    definitions.push([
      "plugin_data.csf_list_profiles_page(uuid,text,text,uuid,text,text,text,text,uuid,integer)",
      memberDirectorySearchUpgrade
        ? "69a3d086915e57c9871ed3fa1cec1893"
        : activeDirectoryUpgrade
          ? "8abb87daa63ef1b5dad124f89bee24d1"
          : "091f2fb0595f586f7b84ce134d6cdee6",
      true,
    ]);
  if (reportedCourseUpgrade)
    definitions.push(
      [
        "plugin_data.csf_normalized_record_schema(text)",
        "2565b4aa9e6b2b25885a2bd548e73850",
        false,
      ],
      [
        "plugin_data.csf_derive_row_commit_payload(text,jsonb)",
        optionalCourseUpgrade
          ? "3c25ee3782d0af261f3c235f6002b8e4"
          : "d01d37d7a11be7615b75d95b706089ca",
        false,
      ],
    );
  if (applicationReviewReopenUpgrade)
    definitions.push([
      "plugin_data.csf_set_review_period(uuid,uuid,uuid,text,text,text,text,timestamptz,timestamptz)",
      "28793d39c02ebf702a61c26deb7ae2b4",
      true,
    ]);
  if (memberDirectorySearchUpgrade) {
    definitions.push([
      "app_private.csf_verified_profile_login_identity(uuid,uuid)",
      "bb732f084499e445c11ae2b324f99f59",
      true,
    ]);
    definitions.push([
      "plugin_data.csf_list_class_directory_page(uuid,uuid,uuid,text,text,text,text,text,text,uuid,integer)",
      "e37e17e30c806043c4c85585a571a106",
      true,
    ]);
  }
  if (activityOptionalStartUpgrade)
    definitions.push([
      "plugin_data.csf_create_activity_locked_impl(uuid,uuid,uuid,jsonb,uuid,uuid)",
      "87408505f6c4d7bd125c0a5eb3914eb7",
      false,
    ]);
  if (activityUndatedLifecycleUpgrade)
    definitions.push(
      [
        "plugin_data.csf_update_activity_locked_impl(uuid,uuid,uuid,uuid,jsonb,uuid,uuid)",
        "9f79790781878bbe3d8cf49677b422d3",
        false,
      ],
      [
        "plugin_data.csf_set_activity_status_locked_impl(uuid,uuid,text,text,uuid,uuid)",
        "325749231832d34fc16e7f935e814281",
        false,
      ],
    );
  if (publicationNotificationsUpgrade)
    definitions.push(...publicationNotificationDefinitions);
  if (publicationWorkerControlUpgrade) {
    const setter = definitions.findIndex(
      ([signature]) =>
        signature ===
        "app_private.set_csf_release_worker_control(text,text,boolean,bigint,uuid,text,text)",
    );
    if (setter < 0)
      throw new ReleaseCheckError("Worker control catalog entry is missing.");
    definitions[setter] = [
      definitions[setter][0],
      "428c972f30cac132f0b93a74072fda41",
      false,
    ];
    definitions.push([
      "public.read_csf_release_worker_controls_v2(text)",
      "0205a3e8b6a9f00535fe63f88b2318d9",
      true,
    ]);
  }
  const csfOneTwoFortySixUpgrade =
    versions.length === 522 ||
    versions.length === 523 ||
    versions.length === 524 ||
    versions.length === 525 ||
    versions.length === 526 ||
    versions.length === 527 ||
    versions.length === 528 ||
    versions.length === 529 ||
    versions.length === 530;
  if (csfOneTwoFortySixUpgrade) {
    for (const definition of csfOneTwoFortySixDefinitions) {
      const existing = definitions.findIndex(
        ([signature]) => signature === definition[0],
      );
      if (existing === -1) definitions.push(definition);
      else definitions[existing] = definition;
    }
  }
  if (versions.length === 523)
    definitions.push(...csfApplicationImportNoopDefinitions);
  if (
    versions.length === 524 ||
    versions.length === 525 ||
    versions.length === 526 ||
    versions.length === 527 ||
    versions.length === 528 ||
    versions.length === 529 ||
    versions.length === 530
  ) {
    definitions.push(...csfApplicationImportNoopDefinitions);
    definitions.push(...csfMixedCategoryResubmissionDefinitions);
  }
  if (
    versions.length === 526 ||
    versions.length === 527 ||
    versions.length === 528 ||
    versions.length === 529 ||
    versions.length === 530
  ) {
    for (const definition of csfFinalGuardDefinitions) {
      const index = definitions.findIndex(
        ([signature]) => signature === definition[0],
      );
      if (index < 0)
        throw new ReleaseCheckError("CSF guard definition is missing.");
      definitions[index] = definition;
    }
  }
  if (
    versions.length === 527 ||
    versions.length === 528 ||
    versions.length === 529 ||
    versions.length === 530
  ) {
    const index = definitions.findIndex(
      ([signature]) =>
        signature === "plugin_data.csf_enforce_new_application_intake()",
    );
    if (index < 0)
      throw new ReleaseCheckError("CSF intake trigger definition is missing.");
    definitions[index] = [
      definitions[index][0],
      "384b099495c0b987bc1bee3ebcf61c24",
      false,
    ];
  }
  const values = definitions
    .map(
      ([signature, digest, service]) =>
        `('${signature}','${digest}',${service})`,
    )
    .join(",\n");
  const upgrade = `, accepted_worker_relations AS (${workerRelationSnapshotQuery}),
accepted_upgrade_definitions(signature,digest,service_execute) AS (VALUES ${values}),
accepted_upgrade_posture AS (
  SELECT count(*) = ${definitions.length} AND coalesce(bool_and(
    p.oid IS NOT NULL
    AND p.proowner = 'postgres'::regrole
    AND md5(pg_get_functiondef(p.oid)) = expected.digest
    AND has_function_privilege('service_role',p.oid,'EXECUTE') = expected.service_execute
    AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
    AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
    AND EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
      WHERE a.grantee='postgres'::regrole AND a.privilege_type='EXECUTE')
    AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
      WHERE a.grantee NOT IN ('postgres'::regrole,'service_role'::regrole)
        OR a.is_grantable OR a.grantor <> 'postgres'::regrole)
  ),false) AND EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgname = 'csf_record_connection_basis_after_audit'
      AND t.tgrelid = to_regclass('plugin_data.csf_admin_audit_events')
      AND t.tgfoid = to_regprocedure('plugin_data.csf_record_connection_basis()')
      AND t.tgenabled = 'O'
      AND t.tgtype = 5
      AND NOT t.tgisinternal
      AND t.tgconstraint = 0
      AND t.tgqual IS NULL
      AND octet_length(t.tgargs) = 0
  ) AND EXISTS (
    SELECT 1 FROM pg_attribute a
    JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    JOIN pg_constraint k ON k.conrelid=a.attrelid
      AND k.conname='csf_profile_accounts_connection_basis_check'
    WHERE a.attrelid=to_regclass('plugin_data.csf_profile_accounts')
      AND a.attname='connection_basis' AND NOT a.attisdropped
      AND a.atttypid='text'::regtype AND a.attnotnull
      AND a.attgenerated='' AND a.attidentity=''
      AND pg_get_expr(d.adbin,d.adrelid) = '''unknown''::text'
      AND k.convalidated AND k.contype='c'
      AND pg_get_constraintdef(k.oid) = $$CHECK ((connection_basis = ANY (ARRAY['unknown'::text, 'verified_email'::text, 'self_confirmed_account_name'::text, 'officer_decision'::text])))$$
  ) ${importReviewUpgrade ? importReviewPosture : ""} ${reprepareUpgrade ? repreparePosture.replace("978fc913e56af1893565d56706941f69", reprepareAuthorityUpgrade ? "a2ae5e479822c1cb54dd405810b6a909" : "978fc913e56af1893565d56706941f69") : ""} ${compoundSearchUpgrade ? compoundSearchPosture : ""} AND (SELECT count(*)=2 AND bool_and(runtime_denied AND digest = CASE relname
    WHEN 'csf_release_worker_controls' THEN '${publicationWorkerControlUpgrade ? "efccf167accba776d136bae856a58a8f" : "b186cfbfbb17fee4e0966cde6d3bec9e"}'
    WHEN 'csf_release_worker_receipts' THEN '94e9bc198f37156522b9aed76bf696a4'
    ELSE '' END) FROM accepted_worker_relations)
  ${publicationNotificationsUpgrade ? publicationNotificationPosture(workerRelationSnapshotQuery, csfOneTwoFortySixUpgrade ? "9615c8ab9d7f7ce4edc4c4bec52811e3" : undefined) + "\n  " : ""}${csfOneTwoFortySixUpgrade ? csfOneTwoFortySixPosture(workerRelationSnapshotQuery, versions.length === 529 || versions.length === 530) + "\n  " : ""}${identityReviewUpgrade ? identityReviewPosture : ""}
  ${
    officerAnnotationUpgrade
      ? composableReviewUpgrade
        ? officerAnnotationPosture
            .replace(
              "ddc531d82a237eae28a29bff3dacffd8",
              annotationReviewStateUpgrade
                ? "5a3d1acada42ee4fff0206684c4cfd77"
                : "984eecbf0c4068bd103d0548aa6adffa",
            )
            .replace(
              "87eceba9e9a24a0e0dc956bdaa3d7139",
              annotationReviewStateUpgrade
                ? "a91a1e38692139da856c4e52e94db60c"
                : "8eb7262bd0f4a527ac382fa761f59182",
            )
        : officerAnnotationPosture
      : ""
  }
  ${
    pendingIdentityUpgrade
      ? composableReviewUpgrade
        ? pendingIdentityPosture.replace(
            "108e1aa1093f02d5d307053cf6f1fd08",
            identityPreviewStateUpgrade
              ? "5bc80be3b2524a588bfa6ae920921a7f"
              : annotationErrorIdentityUpgrade
                ? "1a753bdc4474fb1f5fcbb93f4d56d4d1"
                : "edb9f2c1f2d5ef8f9759b4679328876b",
          )
        : pendingIdentityPosture
      : ""
  } ${pointVerificationUpgrade ? pointVerificationTriggerPosture : ""}
  ${
    canonicalPointUpdateUpgrade
      ? `AND NOT EXISTS (
    SELECT 1 FROM (VALUES ('anon'), ('authenticated'), ('service_role')) roles(name)
    WHERE has_table_privilege(roles.name, 'plugin_data.csf_point_submissions', 'UPDATE')
      OR has_any_column_privilege(roles.name, 'plugin_data.csf_point_submissions', 'UPDATE')
  )`
      : ""
  } ${
    requirementEvidenceUpgrade
      ? applicationRetryUpgrade
        ? requirementEvidencePosture.replace(
            "f990db576f8e2c5a1663b2cfeb784677",
            "13e8ee1bc7b071f00664f808b2cf504a",
          )
        : requirementEvidencePosture
      : ""
  }
  ${applicationRetryUpgrade ? (applicationRangeUpgrade ? applicationRetryRecoveryPosture.replace("a931f85d6e45fd85611adc8318c4da4d", applicationCanonicalRangeUpgrade ? "b18cf72ece0df071e4f2ee7d93616d06" : "d5e26c21ffe78f617f4b34ee82a7eb41") : applicationRetryRecoveryPosture) : ""}
  ${workbookRecoveryUpgrade ? workbookRecoveryPosture : ""}
  ${applicationSourceReviewUpgrade ? applicationSourceReviewPosture : ""}
  ${reviewedWorkbookLinksUpgrade ? reviewedWorkbookLinksPosture(workerRelationSnapshotQuery, sheetSyncUpgrade) : ""}${mergedSourceLineageUpgrade ? `\n  ${mergedSourceLineagePosture}` : ""}
  ${automaticSheetUpdatesUpgrade ? automaticSheetUpdatesPosture(workerRelationSnapshotQuery, matchingTabUpgrade, applicationContactsUpgrade, ownershipUpgrade, sheetSyncUpgrade) : ""}
  ${workbookLinkMergeUpgrade ? workbookLinkMergePosture : ""}
  ${staffAccountConnectionUpgrade ? staffAccountConnectionPosture(staffAccountAuthorityUpgrade, ownershipUpgrade) : ""}
  ${ownershipUpgrade ? reportedContactColumnsPosture : ""}${sheetSyncUpgrade ? `\n  ${sheetSyncPosture(workerRelationSnapshotQuery, sheetDiscussionWriteUpgrade ? sheetDiscussionWriteDefinitions : sheetNoCommentsUpgrade ? sheetNoCommentsDefinitions : sheetToggleUpgrade ? sheetToggleDefinitions : sheetDeferredNoteUpgrade ? sheetDeferredNoteDefinitions : sheetObservationUpgrade ? sheetObservationDefinitions : sheetRecoveryUpgrade ? sheetRecoveryDefinitions : sheetDiscussionUpgrade ? sheetDiscussionDefinitions : undefined, sheetNoCommentsUpgrade ? sheetNoCommentsTables : sheetObservationUpgrade ? sheetObservationTables : sheetRecoveryUpgrade ? sheetRecoveryTables : sheetDiscussionUpgrade ? sheetDiscussionTables : undefined)}` : ""} AS valid
  FROM accepted_upgrade_definitions expected
  LEFT JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature)
)
`;
  return adjusted
    .replace(marker, () => upgrade + marker)
    .replace(
      gate,
      "WHEN (SELECT valid FROM accepted_upgrade_posture) AND (SELECT valid FROM table_posture)",
    );
}

const workbookRecoveryPosture = `AND EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
  WHERE p.oid=to_regprocedure('plugin_data.csf_request_class_workbook_import_recovery(uuid,uuid,uuid,uuid,text)')
    AND p.proowner='postgres'::regrole AND p.prosecdef
    AND p.prorettype='jsonb'::regtype AND l.lanname='plpgsql'
    AND p.prokind='f' AND p.provolatile='v' AND p.proparallel='u'
    AND NOT p.proisstrict AND NOT p.proleakproof AND NOT p.proretset
    AND p.pronargdefaults=0 AND p.proconfig=ARRAY['search_path=""']
    AND p.proargnames=ARRAY['p_organization_id','p_cohort_id','p_actor_user_id','p_request_id','p_expected_drive_file_id']
    AND md5(p.prosrc)='6e5fef90b4b8dc49996de1671053d56a'
    AND has_function_privilege('service_role',p.oid,'EXECUTE')
    AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
    AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
    AND (SELECT count(*)=1 AND bool_and(a.grantee='service_role'::regrole
      AND a.privilege_type='EXECUTE' AND NOT a.is_grantable
      AND a.grantor='postgres'::regrole) FROM aclexplode(p.proacl) a)
)`;

const applicationSourceReviewPosture = workbookRecoveryPosture
  .replace(
    "csf_request_class_workbook_import_recovery(uuid,uuid,uuid,uuid,text)",
    "csf_prepare_application_source_review_periods(uuid,uuid,uuid,integer)",
  )
  .replace(
    "ARRAY['p_organization_id','p_cohort_id','p_actor_user_id','p_request_id','p_expected_drive_file_id']",
    "ARRAY['p_organization_id','p_actor_user_id','p_source_id','p_expected_mapping_version']",
  )
  .replace(
    "6e5fef90b4b8dc49996de1671053d56a",
    "e6110e07dc1807d4780a0fbe7045cf25",
  );

const requirementEvidencePosture = `AND EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
  WHERE p.oid=to_regprocedure('plugin_data.csf_append_import_preview_rows(uuid,uuid,uuid,jsonb)')
    AND p.proowner='postgres'::regrole AND p.prosecdef
    AND p.prorettype='jsonb'::regtype AND l.lanname='plpgsql'
    AND p.prokind='f' AND p.provolatile='v' AND p.proparallel='u'
    AND NOT p.proisstrict AND NOT p.proleakproof AND NOT p.proretset
    AND p.pronargdefaults=0 AND p.proconfig=ARRAY['search_path=""']
    AND p.proargnames=ARRAY['p_organization_id','p_actor_user_id','p_preview_job_id','p_rows']
    AND md5(p.prosrc)='f990db576f8e2c5a1663b2cfeb784677'
    AND has_function_privilege('service_role',p.oid,'EXECUTE')
    AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
    AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
    AND (SELECT count(*)=2 AND bool_and(a.grantee IN ('postgres'::regrole,'service_role'::regrole)
      AND a.privilege_type='EXECUTE' AND NOT a.is_grantable
      AND a.grantor='postgres'::regrole) FROM aclexplode(p.proacl) a)
)`;

const applicationRetryRecoveryPosture = `AND EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
  WHERE p.oid=to_regprocedure('plugin_data.csf_recover_application_retry_matches(uuid,uuid,uuid,uuid)')
    AND p.proowner='postgres'::regrole AND p.prosecdef
    AND p.prorettype='jsonb'::regtype AND l.lanname='plpgsql'
    AND p.prokind='f' AND p.provolatile='v' AND p.proparallel='u'
    AND NOT p.proisstrict AND NOT p.proleakproof AND NOT p.proretset
    AND p.pronargdefaults=1 AND pg_get_expr(p.proargdefaults,0)='NULL::uuid'
    AND p.proconfig=ARRAY['search_path=""']
    AND p.proargnames=ARRAY['p_organization_id','p_actor_user_id','p_preview_job_id','p_after_row_id']
    AND md5(p.prosrc)='a931f85d6e45fd85611adc8318c4da4d'
    AND has_function_privilege('service_role',p.oid,'EXECUTE')
    AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
    AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
    AND (SELECT count(*)=1 AND bool_and(a.grantee='service_role'::regrole
      AND a.privilege_type='EXECUTE' AND NOT a.is_grantable
      AND a.grantor='postgres'::regrole) FROM aclexplode(p.proacl) a)
)`;

const pointVerificationTriggerPosture = `AND EXISTS (
  SELECT 1 FROM pg_trigger t
  WHERE t.tgname = 'csf_point_submissions_verification_freeze'
    AND t.tgrelid = to_regclass('plugin_data.csf_point_submissions')
    AND t.tgfoid = to_regprocedure('plugin_data.csf_enforce_point_submission_freeze()')
    AND t.tgenabled = 'O'
    AND t.tgtype = 31
    AND NOT t.tgisinternal
    AND t.tgconstraint = 0
    AND t.tgqual IS NULL
    AND t.tgnargs = 0
    AND octet_length(t.tgargs) = 0
    AND t.tgattr::text = ''
    AND NOT t.tgdeferrable
    AND NOT t.tginitdeferred
)`;

const pendingIdentityPosture = `AND EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
  WHERE p.oid=to_regprocedure('plugin_data.csf_reconcile_sheet_import_row_identity_base(uuid,uuid,uuid,text,text,uuid,uuid,jsonb)')
    AND p.proowner='postgres'::regrole AND p.prosecdef
    AND p.prorettype='jsonb'::regtype AND l.lanname='plpgsql'
    AND p.prokind='f' AND p.provolatile='v' AND p.proparallel='u'
    AND NOT p.proisstrict AND NOT p.proleakproof AND NOT p.proretset
    AND p.proconfig=ARRAY['search_path=""'] AND p.pronargdefaults=0
    AND md5(p.prosrc)='108e1aa1093f02d5d307053cf6f1fd08'
    AND NOT has_function_privilege('service_role',p.oid,'EXECUTE')
    AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
    AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
    AND (SELECT count(*)=1 AND bool_and(a.grantee='postgres'::regrole
      AND a.privilege_type='EXECUTE' AND NOT a.is_grantable AND a.grantor='postgres'::regrole)
      FROM aclexplode(p.proacl) a)
)`;

const officerAnnotationPosture = `AND EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
  WHERE p.oid=to_regprocedure('plugin_data.csf_review_import_annotation(uuid,uuid,uuid,uuid,text,text)')
    AND p.proowner='postgres'::regrole AND p.prosecdef
    AND p.prorettype='jsonb'::regtype AND l.lanname='plpgsql'
    AND p.prokind='f' AND p.provolatile='v' AND p.proparallel='u'
    AND NOT p.proisstrict AND NOT p.proleakproof AND NOT p.proretset
    AND p.proconfig=ARRAY['search_path=""'] AND p.pronargdefaults=0
    AND md5(p.prosrc)='ddc531d82a237eae28a29bff3dacffd8'
    AND has_function_privilege('service_role',p.oid,'EXECUTE')
    AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
    AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
    AND (SELECT count(*)=2 AND bool_and(a.grantee IN ('postgres'::regrole,'service_role'::regrole)
      AND a.privilege_type='EXECUTE' AND NOT a.is_grantable AND a.grantor='postgres'::regrole)
      FROM aclexplode(p.proacl) a)
) AND EXISTS (
  SELECT 1 FROM pg_proc p
  WHERE p.oid=to_regprocedure('plugin_data.csf_apply_import_annotation_interpretation(uuid,uuid,text,text,uuid)')
    AND p.proowner='postgres'::regrole AND md5(p.prosrc)='87eceba9e9a24a0e0dc956bdaa3d7139'
    AND NOT has_function_privilege('service_role',p.oid,'EXECUTE')
    AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
    AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
    AND (SELECT count(*)=1 AND bool_and(a.grantee='postgres'::regrole
      AND a.privilege_type='EXECUTE' AND NOT a.is_grantable AND a.grantor='postgres'::regrole)
      FROM aclexplode(p.proacl) a)
) AND EXISTS (
  SELECT 1 FROM pg_index i
  WHERE i.indexrelid=to_regclass('plugin_data.csf_officer_annotation_review_request_idx')
    AND i.indrelid=to_regclass('plugin_data.csf_admin_audit_events')
    AND i.indisunique AND i.indisvalid AND i.indisready AND i.indislive
    AND pg_get_indexdef(i.indexrelid)=$$CREATE UNIQUE INDEX csf_officer_annotation_review_request_idx ON plugin_data.csf_admin_audit_events USING btree (organization_id, correlation_id) WHERE (action = 'sheets.annotation_reviewed'::text)$$
)`;

const identityReviewPosture = `AND EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
  WHERE p.oid=to_regprocedure('plugin_data.csf_class_import_review_rows(uuid,uuid,integer)')
    AND p.proowner='postgres'::regrole AND NOT p.prosecdef
    AND p.prorettype='record'::regtype AND l.lanname='sql'
    AND p.prokind='f' AND p.provolatile='s' AND p.proparallel='u'
    AND NOT p.proisstrict AND NOT p.proleakproof AND p.proretset
    AND p.proconfig=ARRAY['search_path=""']
    AND p.pronargdefaults=1 AND pg_get_expr(p.proargdefaults,0)='25'
    AND p.proargnames=ARRAY['p_organization_id','p_job_id','p_limit',
      'id','sheet_tab_name','row_number','import_status','normalized_data','warnings','errors','review_reason']
    AND p.proargmodes::text[]=ARRAY['i','i','i','t','t','t','t','t','t','t','t']
    AND p.proallargtypes=ARRAY['uuid'::regtype,'uuid'::regtype,'integer'::regtype,
      'uuid'::regtype,'text'::regtype,'integer'::regtype,'text'::regtype,
      'jsonb'::regtype,'text[]'::regtype,'text[]'::regtype,'text'::regtype]::oid[]
    AND md5(p.prosrc)='97c62342820cbe42f25b6361725eb630'
    AND has_function_privilege('service_role',p.oid,'EXECUTE')
    AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
    AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
    AND (SELECT count(*)=2 AND bool_and(a.grantee IN ('postgres'::regrole,'service_role'::regrole)
      AND a.privilege_type='EXECUTE' AND NOT a.is_grantable
      AND a.grantor='postgres'::regrole) FROM aclexplode(p.proacl) a)
)`;

const compoundSearchPosture = `AND EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
  WHERE p.oid=to_regprocedure('plugin_data.csf_search_profiles(uuid,uuid,text,uuid)')
    AND p.proowner='postgres'::regrole AND p.prosecdef
    AND p.prorettype='record'::regtype AND l.lanname='plpgsql'
    AND p.prokind='f' AND p.provolatile='s' AND p.proparallel='u'
    AND NOT p.proisstrict AND NOT p.proleakproof AND p.proretset
    AND p.proconfig=ARRAY['search_path=""']
    AND p.pronargdefaults=1 AND pg_get_expr(p.proargdefaults,0)='NULL::uuid'
    AND p.proargnames=ARRAY['p_organization_id','p_actor_user_id','p_query','p_selected_profile_id',
      'id','first_name','preferred_name','last_name','school_email','personal_email']
    AND p.proargmodes::text[]=ARRAY['i','i','i','i','t','t','t','t','t','t']
    AND p.proallargtypes=ARRAY['uuid'::regtype,'uuid'::regtype,'text'::regtype,'uuid'::regtype,
      'uuid'::regtype,'text'::regtype,'text'::regtype,'text'::regtype,'text'::regtype,'text'::regtype]::oid[]
    AND md5(p.prosrc)='b4ab6f2930a415f7d249e5c133e4d051'
    AND has_function_privilege('service_role',p.oid,'EXECUTE')
    AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
    AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
    AND (SELECT count(*)=2 AND bool_and(a.grantee IN ('service_role'::regrole,'postgres'::regrole)
      AND a.privilege_type='EXECUTE' AND NOT a.is_grantable
      AND a.grantor='postgres'::regrole) FROM aclexplode(p.proacl) a)
) AND (
  SELECT count(*)=2 AND bool_and(i.indisvalid AND i.indisready AND i.indislive
    AND NOT i.indisunique AND i.indnkeyatts=2 AND i.indnatts=2
    AND am.amname='btree' AND op.opcname='text_pattern_ops'
    AND i.indkey[0]=a.attnum AND i.indkey[1]=0
    AND pg_get_expr(i.indpred,i.indrelid)=$$(record_status = 'active'::text)$$
    AND pg_get_expr(i.indexprs,i.indrelid)=expected.expression)
  FROM (VALUES
    ('plugin_data.csf_profiles_compact_full_name_prefix_idx',
      $$regexp_replace((normalized_first_name || normalized_last_name), '[^a-z0-9@._+-]+'::text, ''::text, 'g'::text)$$),
    ('plugin_data.csf_profiles_compact_reverse_name_prefix_idx',
      $$regexp_replace((normalized_last_name || normalized_first_name), '[^a-z0-9@._+-]+'::text, ''::text, 'g'::text)$$)
  ) expected(name,expression)
  JOIN pg_index i ON i.indexrelid=to_regclass(expected.name)
    AND i.indrelid=to_regclass('plugin_data.csf_profiles')
  JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_am am ON am.oid=c.relam
  JOIN pg_opclass op ON op.oid=i.indclass[1]
  JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attname='organization_id' AND NOT a.attisdropped
)`;

const repreparePosture = `AND EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
  WHERE p.oid=to_regprocedure('plugin_data.csf_request_class_workbook_reprepare(uuid,uuid,uuid,uuid,text)')
    AND p.proowner='postgres'::regrole AND p.prosecdef
    AND p.prorettype='jsonb'::regtype AND l.lanname='plpgsql'
    AND p.prokind='f' AND p.provolatile='v' AND p.proparallel='u'
    AND NOT p.proisstrict AND NOT p.proleakproof AND NOT p.proretset
    AND p.pronargdefaults=0 AND p.proconfig=ARRAY['search_path=""']
    AND md5(p.prosrc)='978fc913e56af1893565d56706941f69'
    AND has_function_privilege('service_role',p.oid,'EXECUTE')
    AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
    AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
    AND (SELECT count(*)=1 AND bool_and(a.grantee='service_role'::regrole
      AND a.privilege_type='EXECUTE' AND NOT a.is_grantable
      AND a.grantor='postgres'::regrole) FROM aclexplode(p.proacl) a)
) AND EXISTS (
  SELECT 1 FROM pg_index i
  WHERE i.indexrelid=to_regclass('plugin_data.csf_workbook_reprepare_request_idx')
    AND i.indrelid=to_regclass('plugin_data.csf_admin_audit_events')
    AND i.indisunique AND i.indisvalid AND i.indisready AND i.indislive
    AND pg_get_indexdef(i.indexrelid) = $$CREATE UNIQUE INDEX csf_workbook_reprepare_request_idx ON plugin_data.csf_admin_audit_events USING btree (organization_id, correlation_id) WHERE (action = 'sheets.class_workbook_reprepare_requested'::text)$$
)`;

const importReviewPosture = `AND EXISTS (
  SELECT 1 FROM pg_attribute a
  JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
  JOIN pg_constraint k ON k.conrelid=a.attrelid
    AND k.conname='csf_import_rows_resolution_metadata_object'
  WHERE a.attrelid=to_regclass('plugin_data.csf_sheet_import_rows')
    AND a.attname='resolution_metadata' AND NOT a.attisdropped
    AND a.atttypid='jsonb'::regtype AND a.attnotnull
    AND a.attgenerated='' AND a.attidentity=''
    AND pg_get_expr(d.adbin,d.adrelid) = '''{}''::jsonb'
    AND k.convalidated AND k.contype='c'
    AND pg_get_constraintdef(k.oid) = $$CHECK ((jsonb_typeof(resolution_metadata) = 'object'::text))$$
) AND EXISTS (
  SELECT 1 FROM pg_index i
  WHERE i.indexrelid=to_regclass('plugin_data.csf_import_rows_committed_source_key_idx')
    AND i.indrelid=to_regclass('plugin_data.csf_sheet_import_rows')
    AND i.indisvalid AND i.indisready AND i.indislive
    AND pg_get_indexdef(i.indexrelid) = $$CREATE INDEX csf_import_rows_committed_source_key_idx ON plugin_data.csf_sheet_import_rows USING btree (organization_id, cohort_id, plugin_data.csf_class_history_source_key_value(normalized_data)) WHERE (import_status = ANY (ARRAY['created'::text, 'updated'::text]))$$
)`;
