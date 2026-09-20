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
