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

Release 658 publishes signed CSF 1.2.73. Its generated migration writes only the
signed version and catalog pointer. It changes no schema objects or chapter
installations, so it retains the verified 657 inventory with the new ledger
binding. The signature, source ancestry, release bytes and publication statements
were verified before integration.

Release 673 adds seven submission-deletion functions and two temporary cleanup tables.
It changes the submission audit guard and Storage cleanup queue trigger. The reviewed
inventory changes exactly those eleven identities. The provider-owned Storage table
stays outside the shared catalog; the release query separately verifies the exact,
enabled CSF upload trigger. The migration deletes no existing claims on deployment.
Member actions remove their eligible claims and complete physical proof cleanup.

Release 677 publishes signed CSF 1.2.81. The reviewed migration writes only the
signed version and catalog pointer, with no schema or organization-install change.
It retains the verified 676 object inventory and binds it to the new ledger.
Focused controller tests verify the exact publication statements and retry fence.

Release 678 changes the member deletion and both Sheet queue functions. Queue creation
shares the deletion lock, and cleanup scopes records by kind. Its clean
replay inventory contains the same object identities as 677, with three changed
function digests. The focused deletion suite passes 69 assertions, including
in-flight exports, unknown outcomes and previously attempted rows. Release 679
publishes signed CSF 1.2.82 and preserves that inventory.

Release 680 publishes signed CSF 1.2.83. Its generated SQL writes only the signed
plugin version and catalog pointer. It preserves the verified 679 object inventory
and binds it to the new ledger. Controller regression covers the complete suffix
and a retry with no remaining migrations.

Release 681 publishes signed CSF 1.2.84, including the ownership-confirmation retry
fix. The publication preserves the 680 schema inventory and changes no organization
installation. The controller verifies the complete four-migration suffix.

Release 682 changes only the two Sheet queue helpers to acquire the deletion fence
without waiting. A conflicting mutation rolls back with a retry response instead
of waiting while holding submission or binding rows. Both queue paths retain the
post-lock snapshot check. The focused database suite passes 339 assertions.

Release 683 changes only `csf_upsert_profile`. Staff can edit existing reviewed
homonyms while retaining the same normalized name. Creation and name changes
still check for collisions. Email checks also protect confirmed login addresses
on other verified profile accounts and reported application contact evidence. The clean
replay changes one function digest, with no added or removed objects.

Release 685 retains the 683 object identities. A clean replay changes only
`csf_delete_activity`, `csf_upsert_profile`, and the profile and application
relations that receive three contact lookup indexes. Activity removal retains
linked records under archived status. Profile contact checks keep their identity
rules while using indexed reported-contact lookups. Capture uses the same
`postgres` search path as the release controller. The Supabase admin default
includes `auth`, which changes rendered catalog expressions and is unsuitable
for this comparison.

Release 686 adds the signed CSF 1.2.85 publication without changing schema objects.
It reuses the reviewed 685 inventory with the exact 686 ledger binding.

Release 700 removes browser table and column privileges on Google OAuth
credentials and keeps only service-role CRUD. Its clean replay preserves all
1,350 object identities and changes exactly two fingerprints: the credential
relation and the explicit client-grant catalog. The full 455-file SQL suite
passed 11,374 assertions. The accepted catalog query returned one on that
replay, with local fixture helpers removed only inside a rolled-back transaction.
The previous 699 catalog remains accepted for its exact historical ledger.
Unknown future migrations and changed migration bytes still refuse release.

Release 701 adds the service-only personal-calendar disconnect preparation
function. The clean replay adds exactly one object and preserves all 1,350
schema 700 object fingerprints. The new function retains cleanup coordinates
without changing provider events, receipt phases or confirmations. It checks the
exact credential revision, locks source rows before reading their markers and
bounds both the scan and prepared metadata. The 700 catalog still requires its
original exact ledger. All historical migration bytes remain unchanged.
The fresh 456-file SQL suite passed 11,416 assertions at source `a6257a20`.
The exact accepted catalog query returned one after transactional local-helper
teardown; that transaction rolled back. Controller coverage passed 467 tests.

Release 702 makes the three project review fields service-owned. Browser roles
receive explicit access to the other 43 columns, and the legacy creator view
loses browser access. The clean replay retains all 1,351 object identities and
changes exactly the project relation, legacy view and client-grant catalog
fingerprints. Existing row policies, authenticated deletion and service CRUD
remain in place. Every prior migration file retains its original bytes.

The fresh 457-file SQL suite passed 11,501 assertions on runtime source
`09f6dc0a` with the test-only fixture correction integrated at `072dedf4`.
All 15 following database, seed, contract and scale gates passed. The exact
accepted catalog query returned one after transactional fixture-helper teardown;
the transaction rolled back. Controller coverage passed 471 tests. Historical
700 and 701 manifests remain accepted only for their exact ledgers. Hosted
Development comparison and browser acceptance are separate release checks.

The request-fence bootstrap has its own exact 688 ledger, ending at
`20260929051600`. It follows the unchanged 687 published migrations. Its clean
catalog has 1,299 objects: the new request hook is the only added object, and
all prior object digests remain unchanged. Historical 699–702 manifests still
refer to their original ledgers without this newly reviewed bootstrap.

The fixed-prefix bootstrap plan checks every filename and byte digest in the
first 688 migrations, plus the accepted 687 and 688 catalogs. It never applies
or approves later migrations. The owned replay executed the generated atomic
687-to-688 transaction, waited for an already admitted authenticator request,
and verified the exact installed catalog. Separate HTTP checks proved that
reads and writes stay available while the flag is off, activation refuses
writes with SQLSTATE `25006`, and releasing the gate restores writes. A
read-only retry barrier covers an already-applied migration after a lost
response. These local proofs do not authorize a hosted bootstrap.

The hook holds a shared advisory lock until each request transaction ends.
Operator flag changes acquire the exclusive lock in read-committed isolation.
Writable repeatable-read and serializable requests fail closed even when
maintenance is off because their snapshot can predate the lock wait. Read-only
RPCs can retain those isolation levels. The exact verifier also rejects
incompatible served-role or writable RPC defaults, changed hook bodies or
privileges, and conflicting configuration. The maintenance signal lives in
fixed authenticator role-catalog metadata; it is not a client-controlled GUC.
