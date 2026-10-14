# v4 Development feedback candidate

Status reviewed October 14, 2026. This document separates the current source target from hosted and Production acceptance. The dated sections below preserve earlier evidence; their former “current” statements refer to those historical commits.

| Boundary               | Current evidence                                                                                                                                                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Integration            | [PR #874](https://github.com/riddhimanrana/lets-assist/pull/874) carries the v4 candidate. The 729-migration timezone contract is the next source revision; its committed SHA and exact CI run belong in the PR.                                                                            |
| Last full CI           | [Run 38593313600](https://github.com/riddhimanrana/lets-assist/actions/runs/38593313600) passed required jobs on predecessor `49bb8c97`, with `layout_audit=false`. It does not validate migration 729.                                                                                     |
| Visual audit           | [Run 38590623991](https://github.com/riddhimanrana/lets-assist/actions/runs/38590623991) failed the optional layout capture's ledger policy. Whole-site visual acceptance remains open.                                                                                                     |
| Hosted Development     | Source `accba0cfc2cd2f880b5632f4535cea822947da94`, schema 723; [acceptance 38127352315](https://github.com/riddhimanrana/lets-assist/actions/runs/38127352315) failed officer applications route latency on that old source. The v4 target requires a new exact-SHA cutover and acceptance. |
| Development protection | The environment's required-reviewers control was unchecked on October 14. The reviewed maintenance controller requires a configured reviewer and an approved run. Secret names exist, but their bindings are not proved by the settings page.                                               |
| Production             | No v4 Production schema, application, worker or provider change is established by this document. Writer holds, recovery capture, hosted acceptance and compatibility gates precede its separate release.                                                                                    |

Migration 729 pins a reviewed set of 593 stored certificate timezone names that the pinned Node 24 formatter accepts. The self-reported hours parser uses the same checked-in set, canonicalizes supported aliases without changing UTC instants, and rejects names outside the set. Direct database writes and the existing-row precheck use the identical names. The migration only replaces `private.enforce_certificate_event_timezone()` and keeps its explicit ACL. A temporary PostgreSQL 18 catalog check reproduced the historical 728 function fingerprint exactly, then measured only the replacement function's new fingerprint; this does not substitute for a clean PostgreSQL 17 ledger replay. Local parser/API, static, catalog and temporary-database write checks passed. The exact 729 full CI database replay and hosted Development acceptance remain separate gates.

## October 14 review follow-up

Both new review findings are supported. The original column bounds accepted unknown nonblank zones through direct authenticated writes, and the certificate detail/individual print path ignored the saved zone. A forward 727th migration now validates non-NULL zones against `pg_catalog.pg_timezone_names` for INSERT and timezone UPDATE; it fails if prior invalid rows need review. The private trigger uses security-invoker execution with an empty search path, explicit revoke/grant, and no client-callable entrypoint. The prior 726 file and digest stay unchanged. Both existing security-invoker views append display timezone fields while retaining their previous columns and grants.

The detail route keeps its explicit private-data boundary and passes the resolved project/event zone to the document and print button. The owned certificate list and bulk-print paths retain it too. Date components render deterministically without a browser-local-zone loading interval. Project-backed rows retain project-zone precedence and legacy missing zones use the established fallback. DST abbreviations are computed separately at each endpoint.

The focused certificate suite passes, including native server page projection, private-field exclusion, Tokyo date boundary, DST endpoint labels, readable invalid-date state and print-frame completion/cleanup. Controlled actual-component browser checks at widths 390 and 1280, with browser timezone `America/Los_Angeles` and recorded zone `Asia/Tokyo`, passed the certificate document, real individual print-frame interaction and bulk-print interaction with zero runtime/console errors and zero refused requests. Three synthetic PNGs are stored outside tracked source at `/tmp/lets-assist-certificate-timezone`; these are component proofs, not the requested whole-site screenshot set or hosted Next route acceptance.

The preceding short CI [38515455049](https://github.com/riddhimanrana/lets-assist/actions/runs/38515455049) finished failed: static checks, pinned install and typecheck passed; 14 unit assertions rejected the unaccepted target or the obsolete current-target 725 assertion. PR runs correctly skip database replay. The established full workflow checks catalog acceptance before pgTAP and cannot bootstrap a missing reviewed manifest. Its standard CLI dispatch was refused at `https://api.github.com/repos/riddhimanrana/lets-assist/actions/workflows/ci.yml` with Forbidden before a run was created. No alternate access or dispatch route was used. These blockers remain.

Current target: 727 files, latest `20261014060423`, ledger digest `41e425279139fea40028f2c46586b074f188743ee38ff5a2f08101aa851d0b5b`. `ci:pins` still intentionally refuses missing catalog acceptance. The 23 SQL assertions remain unexecuted in this environment. Required next work is an owned clean replay, authorization tests, read-only inventory capture with authoritative fixture teardown, reviewed `final-schema-727.json` registration and complete catalog verification, followed by green short/full gates and exact Development alias/functional acceptance. No Production or worker operation was performed.

## Waiver report and CI correction, October 14

The referenced Library image `libfile_527040595c588191b21ea3053952cc20` was read for its metadata, caption and OCR. That evidence shows the waiver settings panel and the placement warning stating that the project was saved but not published. The actual pixels could not be materialized: the Library-issued transfer host returned `Tunnel connection failed: 403 Forbidden`, including after the approved read-only escalation. The exact switch position and screenshot-specific cause remain unconfirmed; no alternate download route was used.

Independent source reproduction found a concrete readiness defect: `getWaiverStepError` accepted any truthy definition, including empty/stale shapes, as publishable. The create flow uses that result for its step and Create controls, so an incomplete configuration could reach staging and fail later in the server publication check. The fix reuses the existing definition schema and confirms a signing placement, explaining the missing setup on the waiver step. It never requires a participant signature before project publication and never treats prior signature metadata as current signer configuration. Waiver-disabled projects bypass that requirement even when stale metadata is present. Upload-only mode retains its existing behavior; all server publication/storage/signing checks remain unchanged.

Synthetic coverage passed: 29 definition/readiness tests; 29 isolated server creation/idempotency tests (including disabling a previously staged waiver); five create-flow contracts; three organizer-table renders for no-waiver, empty signature join and an existing fictional signed row; two actual settings-component renders with the unopened PDF editor stubbed. No real participant, waiver, signature, legal agreement or provider record was written. The signed fixture is display-test metadata only.

[Short CI 38521328135](https://github.com/riddhimanrana/lets-assist/actions/runs/38521328135) on `c42cab22` finished failed. Static checks found one nullable-string assertion in the certificate test fixture; its runtime assertion now narrows the display snapshot correctly and the native projection tests pass again. A new local typecheck reports only the known missing `xlsx` imports and resulting inferred-type errors. The missing 727 catalog remains a separate unresolved gate. The pixel-unavailable waiver screenshot must still be inspected on an authorized host before claiming its exact reported state is reproduced.

## Reviewed 727 catalog registration, October 14

The exact `1e105e34` candidate replayed all 727 migrations on a fresh owned
PostgreSQL 17.11 volume. Its 502 pgTAP files passed 13,040 assertions. The
reviewed clean inventory has 1,441 objects: compared with the accepted 725
inventory, only `private.enforce_certificate_event_timezone()` was added and
only `public.certificates`, `public.certificate_verification_read_model`, and
`public.user_certificate_read_model` changed. No object was removed. The reviewed
manifest is now registered for exact ledger digest
`41e425279139fea40028f2c46586b074f188743ee38ff5a2f08101aa851d0b5b`;
the 725 historical tests remain bound to their 725 prefix.

A separate new owned volume replayed the same 727 source and the complete
isolated release catalog returned `1`, including the existing release checks.
`ci:pins`, migration file validation, and 74 focused catalog tests pass. This
closes the earlier local catalog blocker; hosted short and full CI, Development
schema/alias acceptance, the unavailable waiver screenshot pixels, and visual
acceptance are still open. No Production or worker operation was performed.

## Points and timezone review follow-up, October 14

The exact-head short CI [38532071369](https://github.com/riddhimanrana/lets-assist/actions/runs/38532071369) passed on `5beae419`. Two subsequent review findings remain valid. On the old v4 candidate, Main's rollback-only points regression failed at the second otherwise-valid donation because a nullable activity `point_cap` fell back to the per-selection `point_value`. The undeployed 725 candidate file now matches the already deployed Main migration byte for byte (SHA-256 `694673006e4a8b1d34e7d57469a7c96b41eb50d789c75d613c8c45a876380a00`), and its regression passes all 33 assertions. No Production migration was changed.

PostgreSQL 17.11 lists 598 timezone names, of which the pinned Node formatter rejected only `Factory`. The 727 trigger accepted that value; the app formatter would silently display it in Pacific time. Forward migration 728 refuses `Factory` on direct writes and fails if existing `Factory` rows need review. It does not rewrite historical instants or invent a timezone for legacy rows. Authenticated INSERT and UPDATE rejection, the PostgreSQL catalog premise, and the app input parser are covered by focused tests.

Clean 725 and 727 prefix replays recaptured their historical manifests; each differs from its previous snapshot only at the reconciled points-function fingerprint. A diagnostic clean 728 replay passed 502 pgTAP files and 13,048 assertions. After explicit ACL statements were added to the replacement trigger, another exact-byte 728 replay passed the 33-assertion points and 26-assertion timezone tests and produced the reviewed 1,441-object manifest. It differs from the recaptured 727 manifest only at the timezone trigger function. A further fresh replay returned `1` from the complete isolated release catalog query. The current 728 ledger digest is `b54353c4317401b5fcac6245b19b3fcf18fd24fde9d1fa50d7e100f54207101c`; `ci:pins` and focused catalog tests pass. All owned stacks were removed with zero residual resources.

The new exact-head short CI and required full integrated-candidate run, hosted Development catalog/permission comparison and alias/journey acceptance, and separate Production compatibility gates remain open. The prior `ci.yml` dispatch was denied before creating a run; no alternate route or permission expansion was used. No Development, Production, worker, participant or legal-agreement record was changed by this review work.
