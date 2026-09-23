# Final schema manifests

Releases through migration 622 retain their historical catalog builders. Release
625 selects a complete manifest by its exact migration-ledger digest. Its runtime
query does not reconstruct or rewrite a predecessor catalog.

`final-schema-inventory.sql` reads definitions and permissions from `public`,
`plugin_data`, `app_private`, and delegated-auth `private`. Extension-owned functions and relations are
excluded. The manifest stores object identities and hashes, never function bodies,
student records, or provider credentials. Relation hashes include full policy
expressions and roles, not only policy counts. ACL entries sort by named roles,
privilege, grantor, and grantability. Policy roles sort by name rather than OID.
Default privileges for postgres and runtime roles and sequence definitions are
captured; sequence values are not. Supabase-admin default privileges are
provider-owned and excluded. Existing repository table ACLs remain fully checked,
including grants made by provider roles. The retention cron definition is
included; other environment-specific cron endpoints are excluded.

To prepare another release:

1. Replay the entire candidate ledger in an owned isolated database. Run its
   database and authorization tests before capturing the inventory.
2. Capture before installing local fixture helpers, or use the exact teardown
   from `scripts/local-dev/seed-hosted-development.mjs`. The generator refuses
   those helpers; the runtime inventory never silently excludes them.
   Run the inventory SQL read-only, wrapping its rows with `SELECT json_agg(row)
FROM (<inventory SQL>) row`. Save the result outside tracked directories.
3. Run `node scripts/production/generate-final-schema-manifest.mjs <repository>
<inventory.json>` and review its output against the preceding manifest. Every
   changed, added, and removed object needs a migration explanation. Never use a
   hosted drifted database as the source of expected permissions.
4. Save the reviewed manifest and register its exact ledger digest in
   `acceptedCatalogQuery`. A schema-neutral signed publication can reuse the same
   object inventory with its new ledger binding after validating the publication.
5. Verify the new catalog on the clean replay. Compare it against hosted
   Development before promotion. Explain any mismatch rather than regenerating
   expectations from the mismatched environment.

The query compares actual and expected inventories in both directions. Unexpected
objects, missing objects, and changed fingerprints fail the release. The inventory
SQL itself is hashed in the manifest so a changed capture contract requires review.
The retired-class join-code and retention-policy data gates remain explicit.
Release checks still separately verify the ledger, staff preference entrypoint,
write posture, signed plugin release, worker controls, and deployment selection.

The 625 inventory was captured after a clean replay of all candidate migrations.
Local fixture helpers were removed inside a rollback-only transaction before
capture. Hosted comparison remains a separate release check.

Release 626 keeps the same reviewed object inventory and binds it to the next
ledger digest. Its forward migration removes a Production-only invitation DELETE
policy that never existed in the clean replay. Browser roles already lacked the
table DELETE grant, so this corrects schema drift without widening access. The
permission regression exercises anonymous, authenticated, and service-role SQL.

Release 627 publishes signed DVHS CSF 1.2.57. Its migration inserts the signed
version and conditionally advances the catalog latest-version pointer. It changes
no schema objects or organization installations. The 627 manifest therefore keeps
the verified 626 object inventory and capture-contract hash, with only the reviewed
migration-ledger binding changed.

Release 628 changes only the seven-argument attendance commit base function. The
clean replay inventory must differ from 627 at that one function identity only.
Existing attendance rows bypass insert guards; authorization, evidence validation,
conflict handling and receipt behavior remain part of the database workflow tests.

Release 631 was captured after a clean isolated replay and 9,990 passing database
assertions. Local fixture helpers were removed only inside the capture transaction,
which was rolled back. The inventory adds eleven functions and changes nine
function definitions and nine relations. It removes no objects.

Migration `20260920180915` adds hold and mapping-version guards, an approved-review
token, automatic staging leases, and applicant counts. Its relation changes are
the decision mappings, releases, stages, and sync rows. Migration `20260920181255`
adds future-only connection, access, and decision notification triggers and updates
sender identity and recipient checks. Its relation changes are communication
campaigns, profile accounts, class memberships, applications, and organization
members. Migration `20260920181754` changes import readiness and overwrite refusal
and adds meeting-scoped preview and attendance counts. These migrations do not
rewrite student records or send historical notices.

Release 654 adds the owner-only prebuilt snapshot queue function and changes the
destination snapshot and export trigger functions. The clean local inventory
changes exactly those three identities and removes no objects. Focused controller
tests bind the inventory to the 654-entry ledger and verify that the forward
controller writes no chapter data. The historical release fixture now includes
this reviewed migration.

Release 655 changes only the function-level timeout on the reviewed term-release
RPC. The clean replay inventory retains every object and ACL. The controller
binds that single changed function to the exact migration and ledger digests.
Ordinary role and database timeout settings remain unchanged.

Release 657 adds the semester activity layout mutation and two section/order
relations. It changes the opportunity relation, both directory status projections,
and the personal Calendar source authorization function. Its clean replay changes
exactly these seven identities and removes no objects. Local fixture helpers were
removed using the authoritative teardown inside a rolled-back capture transaction.
The mutation retains server-only execution, checks officer permissions, serializes
semester edits, and records a fingerprinted receipt. The migration changes no
existing student decisions, evidence, membership, or delivery records.
