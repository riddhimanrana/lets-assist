§G

DVSD production workflow: seasonal membership → approval → tournament registration → guardian judge commitment → reviewed assignment → completion credit.

§C

- Next.js 16 App Router + React 19 + shadcn/Tailwind v4.
- Supabase `plugin_data` remains in PostgREST's schema list for service-role backends; anon/authenticated grants ⊥; RLS remains defense in depth.
- Students authenticate; guardians default contact-only.
- `public.projects` canonical tournament; DV extension 1:1.
- Tabroom read-only; fixture default; live sync opt-in.
- AI draft only; staff approval ! before assignment persistence.
- Existing plugin lifecycle interfaces preserved.
- Main repo + `lib/plugins/private` submodule changes independently versioned.
- DVHS CSF plugin = transactional system of record; Google tools are controlled read/import evidence channels only, while report export is a local ZIP.
- DVHS CSF strict-minor-safe; public student roster/profile membership/proof/attendance ⊥.
- Existing CSF Google data imported read-only + raw source preserved.

§I

- cmd: `bun run dv:dev:reset` → empty local DB replay + deterministic DV fixtures
- cmd: `bun run dv:test:db` → DV schema/RLS integration tests
- cmd: `bun run dv:test:e2e` → Playwright DV journeys
- cmd: `bun run dv:tabroom:smoke` → explicit live Tabroom read-only smoke
- schema: `plugin_data` → seasons, students, households, guardians, memberships, requirements, tournaments, registrations, judges, allocations, service ledger, sync snapshots, audit
- service: `MembershipService` → draft/submit/review/status
- service: `HouseholdService` → guardian normalize/link/merge
- service: `TournamentService` → project extension + registration
- service: `JudgeService` → clearance/availability/assignment/completion
- service: `AllocationService` → deterministic eligibility + AI draft + approval
- provider: `TabroomProvider` → normalized read-only snapshot
- service: `CommunicationService` → preview/queue/delivery log
- manifest: `organizationExperience` → publicPage, publicRoute, members, projects, profileMembership, joinMode
- schema: `plugin_data` → CSF profiles, aliases, terms, memberships, policies, applications, evidence, reviews, activities, submissions, credits, meetings, attendance, partner clubs, imports, appeals, communications, audit
- service: `CsfIdentityService` → verified-email link/request/merge
- service: `CsfRequirementService` → single policy evaluation for UI, reports, exports, term close
- service: `CsfImportService` → raw snapshot, row hash, preview, reconcile, idempotent commit
- route: DVHS CSF workspace → role-aware member/staff sidebar + route-scoped data
- cmd: `bun run typecheck && bun run lint && bun run plugin:test:registry && bun run plugin:test:contracts`
- cmd: `bun run csf:test:workflows` → clean local replay + deterministic CSF workflow assertions
- cmd: `bun run csf:test:e2e` → read-only local role/navigation/browser acceptance

§V

V1: `supabase db reset` → replay ∀ migrations; seed contains fixtures only.
V2: fixture scripts target local Supabase only; committed credentials = ⊥.
V3: ∀ `plugin_data` table → RLS enabled + org/season isolation.
V4: student identity durable across seasons; membership exactly 1 per student+season.
V5: guardian email normalized; guardian account ! not required.
V6: membership status ∈ `draft,submitted,needs_action,approved,rejected,suspended,expired`.
V7: payment/forms/good-standing requirements separate from membership status.
V8: project↔DV tournament relation 1:1.
V9: judge ≠ tournament entry; eligibility checks clearance+training+availability+conflict+qualification+limits.
V10: AI output cannot persist assignment; staff approval + server revalidation required.
V11: Tabroom import immutable raw snapshot + normalized data + sync status; manual overrides preserved.
V12: external integration local/CI default = fixture; live call explicit opt-in.
V13: consequential transition → immutable audit event.
V14: guardian token single-purpose + hashed + expires + one-time consume.
V15: service credit mutation balanced ledger; no derived total overwrite.
V16: build/typecheck/lint/tests pass after staged dependency upgrade.
V17: CSF profile auto-link → authenticated verified email exact match only; name-only claim ⊥.
V18: anonymous/public → CSF member roster, profile membership, proof, attendance, application, trip data ⊥.
V19: CSF application acceptance + term membership transition = 1 transaction + audit.
V20: CSF membership status derived from versioned term policy; manual override → permission + reason + audit.
V21: CSF activity = 1 canonical record; multi-point activity → 1 proof + awarded quantity.
V22: CSF meeting = logical requirement + ≥1 cohort session; attendance → stable profile or reconciliation state.
V23: CSF partner club identity → canonical id + aliases + term-specific audit/policy.
V24: CSF import → immutable raw row + source id/hash + idempotent commit; color/name alone ≠ authoritative state.
V25: CSF prior-term close + next-term onboarding may overlap.
V26: CSF consequential mutation → server permission enforcement + immutable audit event.
V27: CSF student files → private storage + scoped signed access; lifecycle delete removes objects.
V28: CSF requirement evaluation shared by member UI, staff grid, reports, export, term close.
V29: CSF route → fetch route-required data only; all-dashboard aggregate load ⊥.
V30: CSF public page → plugin-controlled safe surface; generic public join/member/project exposure ⊥.
V31: Google Forms/Sheets/Drive → intake, evidence, and migration only after cutover; reviewed platform records authoritative; Google Sheet writeback/report destinations, silent overwrite, and permanent dual authority ⊥; report export = permission-checked local ZIP of formula-safe CSV + manifest.
V32: CSF UI → shadcn/Base UI, explicit text status, accessible dialogs/drawers/tables; color-only state ⊥.
V33: ∀ externally reachable private-plugin operation → fresh auth/capability + active runtime gate before service-role `plugin_data`; every query/mutation tenant-scoped; legacy authenticated-schema client ⊥.
V34: authenticated organization member + plugin `organization.tabs` contribution → host organization tab is canonical; direct plugin route may redirect inward, reverse redirect ⊥.
V35: Google Classroom → retired CSF channel; API integration, draft tracker, delivery state, manual-Classroom instructions, and fake internal messaging center ⊥; cohort posts + the member feed are the active announcement surface; queued ≠ delivered; delivery claims require durable ledger/provider events, while automatic or fixed-cadence dispatch claims also require separately configured + verified hosted worker invocation.
V36: application submission, academic eligibility, dues verification, decision, and term membership outcome → separate typed state dimensions; acceptance requires mandatory checks or adviser override + reason + audit.
V37: officer navigation → Home, Applications, Members, Service, Classes + secondary More menu; Classes → class picker/semester setup or selected class Stream/Members/Points/Meetings by capability; member navigation → Feed, Activities, Point submissions, My CSF; Classroom labels + duplicate/hidden tab triggers ⊥.
V38: legacy class-workbook activity slots → historical import evidence only; canonical point award = normalized numeric ledger entry linked to activity/club + reviewer.
V39: every officer metric → underlying filtered records; invented risk/readiness scores, decorative widgets, hard-coded term requirements, and cross-term report leakage ⊥.
V40: staged import cutover → immutable source provenance + mapping snapshot + row resolution + retry lineage + officer approval before authority transfer.
V41: `bun run csf:test:workflows` → deterministic local CSF fixtures bootstrapped before workflow assertions; a schema-only reset cannot make the gate fail for missing test data.
V42: organization-scoped composite foreign key added beside a legacy single-column key → every affected PostgREST embed names its intended relationship explicitly; runtime relationship ambiguity ⊥.
V43: `bun run csf:test:workflows` always begins with a clean local migration replay before deterministic platform seeding; it never deletes or rewrites immutable audit history in a live fixture database.
V44: server-rendered CSF workspaces → only serializable children cross into Client Component primitives; function-valued children and unkeyed action arrays ⊥.
V45: CSF database tests → isolated identifiers that remain collision-free after either platform-only or full plugin fixture seeding.
V46: CSF import provenance mutation → SQLSTATE `55000` + canonical retry-job guidance; every legacy and reconciliation test asserts the same immutable-source contract.
V47: the deterministic local platform seed → at least one `app_metadata` super-admin fixture so platform-admin approvals remain testable through the visible UI; organization role alone never grants platform administration.
V48: authenticated CSF staff + forbidden direct workflow route → explicit permission-denied state before canonical redirect or private workflow queries; member requests to the same private route remain a marker-free 404.
V49: CSF import-row reconciliation and meeting/partner-club commit → one organization-scoped server-only database transaction including normalized records, source/job state, explicit actor/reason/correlation, and immutable audit event; retry of the same committed snapshot is idempotent.
V50: CSF role access → authorize route, data projection, action, import source type, and report dataset independently; broad route permission never exposes unrelated courses, files, notes, dues, audit, or exports.
V51: CSF list query → URL-backed server search/filter/sort + cursor paging; default ≤50, max ≤100; client-side full-dataset filtering ⊥.
V52: CSF application review → one current-policy eligibility result; stored/source mismatch = `needs_recalculation`; approval blocked until recalculation or adviser override + reason.
V53: CSF Google source workflow → connection identity/health + explicit file/tab/range/header + stable indexed mapping + normalized row preview + reconciliation + commit summary/retry; Picker cancel ≠ error; silent first-tab/default-range import ⊥.
V54: CSF Google import snapshot → explicit operator action; reviewed platform data never silently overwritten; partial commit exposes exact committed/failed/retryable rows.
V55: CSF invitation → reusable class link and student-specific secure link distinct; link-ready/acceptance/expiry/cancel/renew state preserved separately from email telemetry; acceptance + account/profile/membership/audit transition atomic.
V56: CSF officer Home → signed-in actor's executable tasks first; each count links exact filtered records; duplicate queues, marketing copy, invented metrics, and oversized empty states ⊥.
V57: CSF member correction → authenticated in-product scoped form tied to original application/check; mailto-only correction ⊥.
V58: CSF partner club → term approval distinct from optional connected Let’s Assist organization; organization link grants no student-data or staff permission implicitly.
V59: CSF browser acceptance → synthetic namespaced org + one session per distinct role + applicant/member/public; every visible control mapped to positive/negative lifecycle assertion; screenshot-only proof ⊥.
V60: CSF Google/private-data verification → real Drive sources read-only in temporary local org with traces/screenshots disabled; committed artifacts contain synthetic identities only and pass PII/credential scan.
V61: CSF operational UI → compact shadcn lists/tables, 16px icon rhythm, 44–52px rows, ≤24px content offset, page-local URL subviews, mobile full-page fallback, keyboard/focus/screen-reader parity.
V62: CSF process slides → generated only after UI/action labels pass lifecycle acceptance; native editable 16:9 Google Slides use synthetic screenshots, role/prerequisite/steps/recovery/version metadata, and screenshot-staleness manifest.
V63: CSF pgTAP function assertion → repository-bundled helper signature or catalog-backed `to_regprocedure(...)`; release-specific optional helper overloads ⊥; isolated replay proves portability.
V64: CSF closed-term fixture → canonical close workflow or matching organization-scoped closure snapshot + revision/pointer fields; setting `lifecycle_status = 'closed'` without a valid `active_closure_id` ⊥.
V65: CSF application fixture → respect trigger-initialized typed checks; test-specific check state uses keyed upsert/update, duplicate `(organization_id, application_id, check_type)` inserts ⊥.
V66: CSF role-navigation acceptance → every authorized canonical area loads its stable workflow landmark with zero uncaught page errors, console errors, unexpected failed requests, or server 5xx responses; tab visibility alone ⊥.
V67: CSF server-rendered read projection + recognized transient Supabase gateway failure → one bounded read-only retry; mutation replay, unbounded retries, and retrying deterministic database errors ⊥.
V68: root theme bootstrap → client instrumentation applies the persisted/system theme before hydration without rendering a script element in the React tree; client not-found script replay warnings ⊥.
V69: mixed-grade application source + reviewed preview rows resolved to configured cohort-term targets → each row commits through the atomic application import using its immutable resolved cohort; fixed sources crossing cohorts, unconfigured cohort-term targets, and changed row targets ⊥.
V70: CSF member activity claim → current-term published activity + `requires_point_submission = true` in selector & server mutation; officer-recorded activity self-claim ⊥.
V71: CSF Sheet source discriminator → canonical `source_type` equals populated compatibility `settings.sourceKind`; meeting and partner source create/refresh writes the explicit type; contextual sources leaking into class-history workflows ⊥.
V72: selected Google Sheet tab + explicit or unqualified A1 range → one canonical range scoped to that same selected tab across inspection, saved mappings, meetings, and partner-club imports; mismatched or malformed explicit tab provenance ⊥.
V73: CSF officer Home supporting content → quick links auto-fill available width; recent imports/approvals render only with records; single recent section spans full width; dead grid tracks + empty half-cards ⊥.
V74: CSF application list/detail eligibility presentation → one current derived state; stored/current-policy or stored/calculated conflict displays `Needs recalculation` everywhere and the list names one concise blocking issue; contradictory green eligibility or status-only queue rows ⊥.
V75: CSF meeting schedule timestamp → compact Pacific-time label shared with the DVHS operating timezone; raw ISO/UTC timestamp in officer or member UI ⊥.
V76: CSF point correction → verified profile owner + current open term + active membership + current source/policy/proof validation; `needs_action` → `submitted` atomically with prior review/audit preserved + correlated resubmission history; correction ≠ appeal.
V77: compact CSF primary navigation at phone width → first two destinations remain visible and every additional primary destination is duplicated in the mobile-only More menu; clipped or gesture-only destinations ⊥; desktop primary navigation remains one layer.
V78: central CSF preview commit → exact source file ID/name + selected tab/range + accessible immutable file metadata + versioned mapping + resolved cohort and semester on every pending row, enforced in UI and again before the commit job is created; generic provenance fallbacks or unresolved ready targets ⊥.
V79: URL-addressable CSF application review + long evidence record → exactly one compact sticky action bar containing the permitted assignment, request-information, and decision controls; controls disappearing after scroll or duplicated between header and bar ⊥; compact application list unchanged.
V80: Vercel Speed Insights client → render only when the server is executing on Vercel; local, test, and self-hosted runs make no telemetry-script request; blocked third-party debug requests in CSF acceptance ⊥.
V81: Let’s Assist footer branding → same product-company identity across responsive variants; developer, operator, or fixture-person identity in product copyright ⊥.
V82: CSF synthetic fixtures + screenshots → fictional privacy-safe identities on reserved test domains; real external contact identity ⊥; repeat fixture upsert preserves sanitation.
V83: direct CSF proof fixture insert → explicit valid upload lifecycle tuple; finalized proof requires non-null `finalized_at` + null `failed_at`, pending proof requires upload token + null terminal timestamps, and schema defaults never substitute for lifecycle completion.
V84: CSF imported evidence → immutable provider/file identity + revision/modified time + content hash + explicit populated tab/range + term + schema/importer version + sensitivity; grid capacity, hidden/filter state, filename-derived term, password fields, irrelevant qualitative responses, macros, external links, and rejected columns cannot become authoritative rows or retained logs.
V85: CSF account claim → exact unique confirmed school or personal email may offer the limited student confirmation only; response email, preferred-contact email, and account email remain distinct evidence; names never auto-link or create profiles; ambiguous/conflicting/declined matches enter officer review.
V86: CSF club representative access → officer-issued assignment scoped to organization + partner club + term + capability + effective interval; one account may hold multiple assignments; representatives cannot read grades, transcripts, chapter-wide membership, or award points directly.
V87: CSF club operations → audit submission, decision, notification, acknowledgment, point policy, tracker presence, evidence request, attendance/hours/photos completion, proposal, and individual award remain append-only versioned events; current state is a projection, not an overwritten omnibus status.
V88: organization calendar binding → `source_kind` + `source_id` + `occurrence_key`, preserving legacy project schedule bindings; CSF projection is server-only and one-way from published Let’s Assist records; a source-load failure can never be interpreted as remote deletion; personal-calendar actions resolve canonical event content server-side.
V89: CSF email → shared sender interface supports plain text, reply-to, tags, provider idempotency key, and sender override while local development remains Mailpit; campaign audience coordinates/snapshots, content, deliveries, and provider events are durable; raw-body webhook signatures and provider event IDs are verified/deduplicated before state changes.
V90: CSF navigation → one Let’s Assist organization workspace header; desktop keeps Home, Applications, Members, Service, Classes, and More; phone exposes every authorized destination in one full section switcher; Share is a page action, never a competing navigation row.
V91: real CSF source rehearsal → existing data-less preview only, staged in dependency order and stopped at preview/reconciliation until explicit officer commit; synthetic end-to-end gates precede every real-source read; production schema/data/email/calendar/OAuth/cutover mutation ⊥ without separate final approval.
V92: CSF provider mutation → provider-verified exact chapter account + purpose-bound minimum scope + exact console/config diff; Gmail remains reply/evidence only and never a send transport; Resend topic/webhook creation and Google console changes occur only after local delivery/sync acceptance.
V93: CSF performance work → representative synthetic scale + reviewed `EXPLAIN (ANALYZE, BUFFERS)` before index removal/addition; empty-preview unused-index advice alone never authorizes deletion.
V94: CSF pgTAP fixtures for organization-scoped composite relationships → referenced parent rows are inserted before dependent rows unless the foreign key is explicitly deferred; isolated replay must reach the planned assertions instead of failing during fixture setup.
V95: CSF provider safety evidence → missing or unrecognized bounce/suppression subtype becomes one bounded non-null token; unauthorized evidence cannot reserve or bind a delivery identity; identical internal safety replay is idempotent behind a uniqueness backstop while conflicting replay fails closed.
V96: CSF PL/pgSQL text-array diagnostics → scalar blocker messages are appended with `array_append(text[], text)` rather than ambiguous `text[] || unknown`; isolated replay exercises every diagnostic branch without attempting to parse prose as an array literal.
V97: CSF proof file acceptance → server reads the upload once, requires a supported extension + reported MIME + matching magic bytes, persists the canonical detected MIME and actual byte count, and uploads those exact validated bytes; client metadata alone ⊥.
V98: CSF current semester → create/edit validates and persists the submitted date window; selecting current is one organization-serialized, permission-checked RPC that rejects closed/archived/cross-tenant targets and swaps the pointer with its immutable audit receipt in the same transaction; clear-then-set writes ⊥.
V99: CSF role template lifecycle → TypeScript and SQL share the complete permission catalog; title/responsibility/description/permissions/seat limit edits are tenant-scoped and audited; custom archive is reversible and history-preserving, system archive and active-role archive ⊥, and archived roles can never receive an assignment.
V100: CSF partner representative mutation → assignment, verified-email/account acknowledgment, correction request, and revocation each re-authorize exact organization + club-term + actor scope in a service-only RPC and commit capability state with append-only lifecycle/admin receipts atomically; request replay is idempotent and conflicting replay ⊥.
V101: Google Calendar grant → new calendar purposes request exact `calendar.app.created`; callback and every credential consumer parse whitespace-delimited scope tokens, accept the minimum scope or the staged legacy full-Calendar scope, and reject read-only/substring lookalikes; an existing calendar identity is replaced only after confirmed `404`.
V102: CSF partner-club semester standing → stable request id + database permission recheck + organization lock; current projection, append-only term event, and staff audit commit atomically; exact replay is idempotent, conflicting replay ⊥, and a no-op request records an explicit non-mutating receipt.
V103: Plugin behavior, lifecycle, and form boundaries → host-owned concrete result and form-schema types; cast-only compatibility, dead behavior fields, and unvalidated unknown JSON entering form editors ⊥; root typecheck and focused source-contract tests gate the boundary.
V104: CSF profile merge or officer connection resolution → server-derived hard-conflict checks + stable corroborating identity beyond any name-only signal; an officer connection requires the current confirmed account email to match the request snapshot and exactly one active roster record, plus exact first/last name and one matching active cohort; candidate suggestions are review aids and never a one-click approval assertion.
V105: CSF application review and decision → one server-derived preflight shared by queue, detail, sticky actions, and confirmation; missing course evidence, stale calculation, failed mandatory check, or stored/derived disagreement blocks ordinary approval and cannot coexist with `Ready for approval` or an all-green confirmation.
V106: CSF invitation link lifecycle ≠ email delivery lifecycle; create/renew/copy changes link state only, while `last_sent_at`, resend count, delivery status, and sent copy change only after a durable recipient delivery is queued and receipted; current direct-link UI names `Create link`, `Copy link`, and `Renew link` and makes explicit that no email was sent; a future `Send email` action cannot exist without that durable path.
V107: CSF post publication + optional announcement email → a `manage_posts` actor can reach the composer, publish/reply, and request the post-linked campaign; the result distinguishes `post saved`, `email queued`, and `email not queued`, and no error may say the post was not saved after persistence.
V108: CSF import commit readiness → one server-derived blocker list drives job status, summary labels, and commit availability; failed, stale, inaccessible, unresolved-target, or incomplete-provenance jobs cannot render `Ready`, `No conflicts`, or an enabled commit action.
V109: CSF action UI → one activation starts one request, disables repeat activation while pending, exposes a named success/error outcome through an appropriate live region, closes/resets only after confirmed success, and preserves entered data after failure; silent first clicks, nested interactive controls, and unlabeled icon buttons ⊥.
V110: CSF communications configuration and recovery → an authorized `manage_settings` actor has a reachable CSF-owned settings surface for consent topic, Resend topic, sender, and integration health; durable unknown-outcome/quarantine records have a permission-checked, provider-evidence-only officer reconciliation path; blind resend, invented delivery, event rewrite, inaccessible generic private-plugin settings, and provider state without an operator path ⊥.
V111: CSF member-facing payload → member-visible content only; officer operational state (email/campaign delivery lifecycle, review holds, provider evidence) is omitted from the serialized response unless the reader's post authority was re-derived server-side for that request; conditional rendering as the only boundary ⊥.
V112: CSF Google Sheet + report boundary → Sheets are explicit read/import evidence only; no writeback, timestamped compatibility tab, or report destination; export = permission-checked local formula-safe ZIP + manifest.
V113: CSF student-specific secure link → selected active profile + one current unique recorded school/personal email + term + stable request id; arbitrary/shared/missing email ⊥ and correction precedes creation; create/copy/renew sends no email; replay revalidates current profile/email/link evidence.
V114: CSF semester grade policy → versioned List I/II/III × A/B values with baseline `I 3/1`, `II 2/1`, `III 1/0`; A+/A− → A and B+/B− → B; draft saves preserve valid advanced keys and do not affect calculation until publish.
V115: CSF import match/skip + history → typed decision + required visible bounded officer reason; pending disables repeat, failure preserves fields, success alone resets; history renders only recorded operator/digest/counts/reconciliation/reason/ancestry and labels missing facts rather than inventing zero or identity.
V116: CSF request-aware application decision/profile merge/direct-link/post mutation → fresh permission before receipt lookup + organization/request lock + actor/normalized-intent fingerprint + atomic canonical mutation/audit receipt; exact replay only while target/state/supporting evidence remains current; reused or stale intent ⊥.
V117: CSF post email campaign → immutable term + audience kind + exact same-organization class cohort when class-scoped + consent topic + content + recipient snapshot; retries and later post/profile/cohort changes cannot widen, shrink, or rewrite the frozen campaign.
V118: CSF Google import connection → verified user-info identity exactly `dvhighcsf@gmail.com` on the organization/plugin/import binding; wrong/missing/legacy identity requires reconnect; disconnect preserves reviewed records/provenance, shared grants are not silently revoked, and remote revocation is claimed only after provider confirmation.
V119: CSF communications recovery → an unresolved attempt changes outcome only from durable provider evidence and is never blindly resent; webhook quarantine resolution = one tenant-scoped reasoned triage acknowledgement + audit and never applies/retries/suppresses/rewrites the event.
V120: CSF scheduled post → persisted `scheduled_for` ≠ publication/feed visibility/email; automatic schedule claims ⊥ until the dedicated due-post publisher reauthorizes, serializes, transitions + audits atomically, queues optional email only after publication, and passes migration + route + pgTAP + central replay acceptance; meanwhile manual publication is the temporary pre-acceptance operator path.
V121: CSF point lifecycle mutation → begin/proof finalization/withdraw/review/appeal submit/appeal decision reauthorizes actor/owner, organization, current open term, active membership, published policy, source relationship, numeric cap, class, and finalized proof under lock as applicable; browser or earlier eligibility evidence alone ⊥.
V122: CSF communications scheduler → service-only tenant discovery returns one short-lived reservation at a time without advancing fairness; exact acknowledgement immediately before claim records a bounded worker attempt, releases the reservation before campaign locks, and makes both abandoned reservations and claim-time faults unable to starve later tenants; per-tenant cyclic campaign cursors derive work from available queued attempts ∪ every expired processing lease regardless of campaign status; terminalization checks a bounded fair campaign scope before/after worker passes, provider calls are abortable with settlement reserve under one absolute route deadline, oversized claim responses are refused before send, settled campaigns cannot remain open after a lost response, cancelled leases still reach unknown-outcome review without resend, nonterminal/faulting prefixes cannot starve later tenants or campaigns, and live/retry/unknown/undispatched work remains nonterminal.
V123: CSF profile merge → every exact-current-schema reference to `csf_profiles` is cataloged as same-transaction current-ownership rewrite, deliberate immutable-history retention, or canonical preflight blocker; preview and locked execution share every uniqueness rule, including the active point-claim partial index; one organization identity advisory lock precedes request/table/row locks across merge, profile write/import, claim, direct-invitation acceptance, and connection resolution; cross-organization work remains independent; success requires zero unintended live source references plus non-PII review/audit evidence.
V124: CSF profile merge × sheet-import target → only `commit_outcome_state=not_started ∧ commit_frozen_at=NULL ∧ commit_target_profile_id=NULL` is mutable current match ownership; coherent `succeeded ∧ import_status∈{created,updated}` and `failed ∧ import_status=skipped ∧ commit_outcome_resolution=terminally_skipped` lineage retains both matched/frozen source references as immutable commit/recovery evidence; every frozen, in-flight, unknown, historical-unknown, retryable-failed, or malformed remainder ⊥ through one canonical preview/execution blocker under the organization identity lock; claim takes that lock before coordinate/row locks; execution locks affected import rows before preview, rewrites only the mutable class, audits its exact count, and proves zero nonhistorical source references.

§T

id|status|task|cites
T1|x|fix local Supabase replay, fixtures, credentials, CI commands|V1,V2,V12,I.cmd
T2|x|add consolidated seasonal household/membership/judge schema + RLS + migration|V3,V4,V5,V6,V7,V8,V9,V13,V14,V15,I.schema
T3|x|add typed domain contracts + repositories/services|V3,V4,V5,V6,V7,V8,V9,V10,V13,V15,I.service
T4|x|add Tabroom provider, fixture snapshots, sync runs, fallback|V11,V12,I.provider
T5|x|add deterministic eligibility + AI draft review/approval flow|V9,V10,V13,I.service
T6|x|complete student/staff vertical-slice UI + guardian token flow|V4,V5,V6,V7,V8,V9,V13,V14
T7|x|replace simulated communications with preview/queue/log adapter|V12,V13,I.service
T8|x|upgrade compatible stack + shadcn diff review|V16
T9|x|add unit, DB/RLS, integration, Playwright coverage|V1,V2,V3,V4,V5,V6,V7,V8,V9,V10,V11,V12,V13,V14,V15,I.cmd
T10|x|rewrite DV architecture/status/plugin development docs|V1,V3,V4,V5,V8,V9,V10,V11,V12
T11|x|secure CSF identity/public privacy + make plugin/migration reproducible|V17,V18,V26,V27,V30,I.manifest,I.schema
T12|x|add CSF domain foundation, route-scoped services, workspace shell, policy evaluator|V19,V20,V25,V26,V28,V29,V32,I.schema,I.service,I.route
T13|x|complete profiles, applications, onboarding, term membership review flow|V17,V19,V20,V24,V25,V26,V27,V32,I.service,I.route
T14|x|complete canonical partner clubs, activities, single-proof submissions, awarded credits|V21,V23,V26,V27,V28,V32,I.schema,I.service,I.route
T15|x|complete meeting sessions, attendance reconciliation, points grid, appeals, term close|V20,V22,V24,V25,V26,V28,V32,I.schema,I.service,I.route
T16|x|add communications workspace + safe plugin-backed public CSF surface|V18,V26,V30,V31,V32,I.manifest,I.route
T17|x|import legacy CSF data, local report exports, security/integration/E2E coverage|V17,V18,V19,V20,V21,V22,V23,V24,V25,V26,V27,V28,V29,V30,V31,V32,I.cmd
T18|x|cut DV runtime to explicitly authorized service-only data access and re-enable version 2|V3,V13,V14,V33,I.service,I.cmd
T19|x|write DVHS CSF product source-of-truth + current-state removal/rename matrix|V17,V18,V19,V20,V21,V22,V23,V24,V25,V26,V27,V28,V29,V30,V31,V32,V34,V35,V36,V37,V38,V39,V40
T20|x|normalize application checks, dues, deadlines, provenance, assignment, audit, and atomic decisions|V3,V13,V19,V20,V24,V26,V27,V31,V33,V36,V40,I.schema,I.service
T21|x|replace CSF shell/navigation with canonical officer/member IA|V18,V29,V30,V32,V34,V35,V37,V39,V77,V81,I.manifest,I.route
T22|x|rebuild application import, eligibility, review, dues, decision, and correction workflows|V17,V19,V20,V24,V26,V27,V28,V32,V36,V39,V40,I.service,I.route
T23|x|rebuild member directory, account connection, semester record, senior recognition, and My CSF|V17,V18,V20,V25,V26,V28,V29,V32,V36,V37,V39,I.service,I.route
T24|x|rebuild activities, numeric point submissions, meetings, and partner-club operations|V20,V21,V22,V23,V24,V26,V27,V28,V32,V35,V38,V39,V40,I.schema,I.service,I.route
T25|x|rebuild semester deadlines/policy/close, term-scoped reports, history, and safe public surface|V18,V20,V25,V26,V28,V29,V30,V31,V32,V39,I.service,I.route
T26|x|replace fixtures with realistic fictional CSF cases + deterministic DB/unit/core-browser/cutover regression coverage|V1,V2,V3,V17,V18,V19,V20,V21,V22,V23,V24,V25,V26,V27,V28,V29,V30,V31,V32,V33,V34,V35,V36,V37,V38,V39,V40,V41,V42,V43,V44,V45,V82,V83,I.cmd
T27|x|split CSF route/data/action/import/report authorization + add server cursor paging|V3,V18,V26,V29,V33,V42,V48,V50,V51,I.service,I.route
T28|x|refine role-aware Home + compact application list/full-page review|V29,V32,V36,V37,V39,V44,V51,V52,V56,V61,V73,V74,V79,I.route
T29|x|build Google connection center + staged Sheet/XLSX import wizard|V24,V31,V40,V46,V49,V53,V54,V60,V61,V69,V71,V72,V78,I.service,I.route
T30|x|complete direct/cohort invitations, account connection, member correction, and staff seat lifecycle|V17,V19,V26,V33,V36,V50,V55,V57,V61,V99,I.service,I.route
T31|x|complete meeting source health, row reconciliation, audited corrections, and member attendance|V22,V24,V26,V28,V40,V49,V53,V54,V61,V71,V72,V75,I.service,I.route
T32|x|rebuild partner-club table/detail, audit/credit imports, standing history, and optional connected organization|V21,V23,V24,V26,V40,V49,V53,V54,V58,V61,I.service,I.route
T33|x|complete activity + point proof/correction/adjustment/rejection/appeal lifecycle|V20,V21,V26,V27,V28,V35,V38,V50,V61,V70,V76,V83,V97,I.service,I.route
T34|x|split Semester subviews + publish policy + close/reopen + scoped reports/human history|V20,V25,V26,V28,V39,V50,V51,V61,V98,I.service,I.route
T35|~~|run every-role synthetic lifecycle, Google failure fixtures, accessibility, cross-browser, privacy, and scale gates|V1,V2,V3,V18,V26,V30,V33,V41,V43,V45,V47,V48,V49,V50,V51,V52,V53,V54,V55,V56,V57,V58,V59,V60,V61,V66,V68,V77,V80,V81,V82,V83,I.cmd
T36|.|create native Google Slides process suite + screenshot manifest after T35 acceptance|V60,V62
T37|x|recover Docker + isolated CSF stack, replay migrations, seed synthetic data, run current unit/runtime/type/scale/browser gates, and recapture sanitized desktop/tablet/phone baseline|V1,V2,V12,V59,V60,V82,I.cmd
T38|x|extend source snapshots, atomic generic import commit, term-scoped club representatives, append-only club lifecycle, calendar bindings, and durable CSF communications without duplicating the existing domain|V24,V27,V33,V40,V49,V84,V85,V86,V87,V88,V89,V93,V94,V95,V96,V100,V101,V102,I.schema,I.service
T39|.|run bounded Claude Opus shell/student, applications/members, service/clubs, imports/semester, and accessibility waves inside the Let’s Assist organization shell|V18,V29,V30,V32,V34,V37,V44,V48,V50,V51,V56,V59,V61,V77,V79,V80,V81,V82,V85,V86,V90,I.route
T40|x|add privacy-shaped synthetic fixtures and action-matrix coverage for duplicate identities, partial imports, attendance ambiguity, proof retry/appeal, multi-club representative access, communications outcomes, calendar lifecycle, and term close/reopen|V41,V43,V45,V47,V49,V52,V54,V55,V57,V58,V59,V60,V66,V67,V69,V70,V72,V76,V78,V82,V83,V84,V85,V86,V87,V88,V89,V93,I.cmd
T41|.|validate purpose-bound Google/Drive/Sheets/Calendar and Resend integrations under the visibly confirmed chapter account, create no persistent provider state until local tests pass, and preserve Gmail as evidence/reply only|V31,V53,V54,V60,V84,V88,V89,V91,V92,I.provider
T42|.|repair existing data-less Supabase preview configuration, restore least-privilege CI submodule access, disposition the historical local test credential finding, rehearse real sources preview-only, and hold every Production/cutover gate for separate approval|V2,V12,V33,V60,V82,V91,V92,I.cmd
T43|~~|close the lifecycle audit defects across identity/application safety, truthful invitations/imports/posts, policy values, provider identity/recovery, point authority, role reachability, action state, member-payload scoping, and accessibility|V31,V32,V50,V52,V55,V59,V61,V66,V74,V78,V85,V89,V92,V104,V105,V106,V107,V108,V109,V110,V111,V112,V113,V114,V115,V116,V117,V118,V119,V120,V121,V123,V124,I.schema,I.service,I.route,I.cmd

§B

id|date|cause|fix
B1|2026-06-21|DV fixture `join_code` exceeded existing `varchar(6)`|V2
B2|2026-06-21|bulk requirement upsert omitted non-null `metadata`|V2
B3|2026-06-21|ledger immutability test expected trigger before RLS denial|V15
B4|2026-06-21|removed dev button left empty JSX conditional|V16
B5|2026-06-21|legacy wrapper lacked season narrowing; Kotlin-JS payload needed `unknown` bridge|V16
B6|2026-06-21|Bun tests ran but TypeScript lacked `bun:test` declarations|V16
B7|2026-06-21|Bun DOM typings required explicit non-string FormData narrowing|V16
B8|2026-06-21|SSH commit signing required unavailable key passphrase|task commits use `-c commit.gpgsign=false`
B9|2026-06-21|Supabase client upgrade caused recursive generic query inference in report date helper|inline typed range filters at the two query boundaries
B10|2026-06-21|React/TypeScript patch upgrade exposed optional waiver placement IDs|fall back to stable field key during placement normalization
B11|2026-06-21|Playwright 1.61 had no matching local Chromium binary|install pinned Chromium before browser verification
B12|2026-06-21|Next.js 16 treated synchronous service helpers as invalid Server Actions|reserve `use server` for action entrypoints, not service libraries
B13|2026-07-09|CSF requirement tests encoded semester total as 1 activity despite per-activity cap|V20,V28
B14|2026-07-09|bulk organization seed mixed explicit non-null privacy field with omitted values → PostgREST null inserts|V2,V18
B15|2026-07-09|async proof decorator inferred only added fields and erased submission row shape|V29
B16|2026-07-09|closing the current term removed the selector and member UI mislabeled the closed membership as pending|V20,V25,V28
B17|2026-07-09|scheduled announcement fixture omitted the new required publish time|V31,I.cmd
B18|2026-07-09|legacy partner forms used duplicate email labels and a newer point-allocation question phrase|V23,V24,V31
B19|2026-07-09|CSF workflow smoke test assumed organization `slug`; platform route key is `username`|V30,I.cmd
B20|2026-07-09|CSF workflow smoke test used a draft membership FK name instead of `application_id`|V19,I.cmd
B21|2026-07-09|CSF workflow smoke test assumed generic term `status`; CSF uses `is_current` plus closure metadata|V20,V25,I.cmd
B22|2026-07-09|legacy inspector exposed worksheet rows as `unknown` instead of the parser's supported cell union|V24,I.cmd
B23|2026-07-11|DV catalog re-enable reached a legacy authenticated `plugin_data` client after browser grants were revoked|V33
B24|2026-07-12|host page redirected every plugin-public member outward while CSF direct routes redirected inward, creating a canonical-route loop|V34
B25|2026-07-14|CSF workflow gate assumed the full local seed had already run after a schema-only reset|V41
B26|2026-07-14|new organization-scoped application foreign key made an unqualified Supabase term embed ambiguous at runtime|V42
B27|2026-07-14|repeat CSF workflow seeding tried to delete term-linked rows protected by the immutable audit trigger|V43
B28|2026-07-14|member-only My CSF rendered a function child into the client progress primitive and an unkeyed action array|V44
B29|2026-07-14|the point-withdrawal pgTAP reused a join code from the optional Speech and Debate fixture pack|V45
B30|2026-07-14|the account-unlink RPC locked a full profile row into an unused PL/pgSQL variable|use a scoped existence lock without retaining the row
B31|2026-07-15|the reconciliation migration strengthened immutable-import errors but the legacy pgTAP still asserted the superseded SQLSTATE and message|V46
B32|2026-07-15|the local developer fixture was an organization admin but lacked the trusted auth claim required by every platform-admin page|V47
B33|2026-07-16|a standalone CSF route redirected before granular officer permissions were evaluated, silently replacing denial with Home|V48
B34|2026-07-16|meeting attendance and partner-club reconciliation committed through separate PostgREST statements, allowing a mid-flight failure to leave partial records without matching audit history|V49
B35|2026-07-16|a CSF pgTAP test used a helper overload not supported by the repository-bundled pgTAP signature, so disposable replay failed before testing behavior|V63
B36|2026-07-16|legacy CSF fixtures set a term directly to `closed` without the closure snapshot pointer required by the closure invariant|V64
B37|2026-07-16|the direct-invitation fixture inserted checks already initialized by the application trigger, violating the typed-check uniqueness contract|V65
B38|2026-07-16|the member workspace crashed because point-appeal embeds did not name the new organization-scoped profile, term, and submission relationships|V42
B39|2026-07-16|role-navigation tests asserted the Members tab but never loaded its directory or monitored browser/server failures, allowing a staff-visible runtime exception to escape the suite|V66
B40|2026-07-16|the local Supabase gateway intermittently returned an invalid upstream response for a valid member-directory read, crashing a server render even though the same projection immediately succeeded|V67
B41|2026-07-16|Next's before-interactive Script emitted a raw script element into the App Router React tree, so client-side not-found navigation warned even after the component was moved into the document head|V68
B42|2026-07-16|grade-derived application sources correctly stored no single cohort, but the atomic import RPC still required the source cohort to equal every resolved row cohort, making all mixed-grade commits fail|V69
B43|2026-07-16|member activity projection overwrote claim mode while selector and mutation ignored it, exposing officer-recorded activities to point claims|V70
B44|2026-07-16|meeting and partner source writes omitted the typed discriminator after it gained a class-history default, so correctly tagged JSON settings could still be routed through the wrong import workflow|V71
B45|2026-07-16|meeting, partner-club, and saved-mapping imports accepted an explicit A1 range naming a different tab than the selected tab, allowing rows and recorded provenance to disagree|V72
B46|2026-07-16|Home used fixed 4/2-column grids and rendered empty recent panels, leaving dead officer-workspace columns|V73
B47|2026-07-16|application review displayed stored green eligibility alongside a failing current calculation, while the simple queue omitted the specific issue an officer needed to resolve|V74
B48|2026-07-16|semester meeting rows rendered the raw stored ISO timestamp beside a localized date, forcing officers to interpret UTC instead of the chapter's Pacific time|V75
B49|2026-07-16|`needs_action` reused the point-appeal UI while active-claim uniqueness blocked a replacement claim, leaving members unable to correct and return the original claim to review|V76
B50|2026-07-16|the compact organization tab strip hid its scrollbar while retaining every primary CSF tab, so phone users could not discover Members, Service, or Semester and the visible More menu contained only administrative pages|V77
B51|2026-07-16|the central import button treated row counts as sufficient readiness and the server created a commit job before proving exact file, tab, range, mapping, access, cohort, and semester provenance|V78
B52|2026-07-16|application assignment, request-information, and decision controls lived only in the detail header, so reviewers lost access to them while scrolling through course, file, check, dues, note, and history evidence|V79
B53|2026-07-16|the root layout rendered Vercel Speed Insights in every environment, so local Chromium sessions accumulated blocked external debug-script requests and failed otherwise-correct role acceptance|V80
B54|2026-07-16|mobile Footer hard-coded a developer identity while desktop used product-company branding|V81
B55|2026-07-16|a synthetic partner-club fixture and gallery capture contained a real external contact identity|V82
B56|2026-07-16|the workflow proof-uniqueness probe relied on the legacy finalized status default but omitted the required finalization timestamp, violating the current proof lifecycle tuple|V83
B57|2026-08-01|the import-recovery pgTAP fixture inserted a staging object before its organization-scoped source parent and failed before any planned assertion|V94
B58|2026-08-01|durable communications let a missing suppression subtype collapse to SQL null, let unauthorized evidence name an unreserved delivery identity, and could duplicate an internally replayed address-safety event|V95
B59|2026-08-01|the import readiness function used `text[] || unknown` for scalar prose, so PostgreSQL selected array concatenation and tried to parse a blocker sentence as an array literal|V96
B60|2026-08-01|the point action trusted a browser filename and MIME declaration, then reread the file for storage instead of persisting the bytes and type it had actually validated|V97
B61|2026-08-01|semester creation discarded submitted start/end dates and current selection cleared the old pointer before setting the replacement, allowing partial state without a matching audit receipt|V98
B62|2026-08-01|custom role creation retained an older permission catalog while the real Staff workspace had no audited edit or reversible archive path and assignment did not reject retired roles|V99
B63|2026-08-01|partner representative activation and its acknowledgment receipt were separate writes, assignment had no lifecycle receipt, request replay could duplicate, and officers had no revoke workflow|V100
B64|2026-08-01|Google OAuth treated any scope containing `calendar` as write authorization and personal calendar replacement followed ambiguous lookup failures instead of requiring a confirmed missing result|V101
B65|2026-08-01|partner-club semester standing updated its current row and admin audit but skipped the append-only club-term event stream, and the action supplied no stable replay identity|V102
B66|2026-08-01|DV plugin behavior and stored-form boundaries used any/unknown casts that hid a dead navigation field and allowed unvalidated schema data into the form editor|V103
B67|2026-08-09|the merge preview marked unrelated synthetic students ready and exposed a consequential merge despite conflicting identity evidence|V104
B68|2026-08-09|application detail mixed stale and failing academic evidence with ready/all-green approval UI|V105
B69|2026-08-09|direct invitation create and renew changed sent-at and resend telemetry even though the product only created or copied a link|V106
B70|2026-08-09|posting roles could persist a post, fail the settings-only campaign RPC, lose route visibility, and then receive the false message that the post was not saved|V107
B71|2026-08-09|a failed or incomplete import could render preview-ready, no-conflict copy and an enabled commit action because UI readiness diverged from server blockers|V108
B72|2026-08-09|successful or pending dialogs accepted silent/repeated clicks, retained stale state, and exposed unlabeled or nested controls without a reliable result announcement|V109
B73|2026-08-09|CSF communications directed officers to generic plugin settings that private plugins disable and exposed no operator path for durable unknown outcomes|V110
B74|2026-08-09|officer resolution of an account-connection request offered a one-click connect from a similarity ranking, and the resolve RPC accepted it with no corroborating identity attribute, so a same-named classmate could be bound to a student account|V104
B75|2026-08-09|member feed and stream payloads carried per-post email delivery state for every reader and relied on conditional rendering to hide it|V111
B76|2026-08-09|student-specific invitation creation accepted an officer-typed recipient and lacked one replay-safe request receipt, so the address could differ from the selected active profile and a lost response could duplicate link intent|V113,V116
B77|2026-08-09|semester policy calculation stored configurable grade-point mappings, but the officer editor did not expose the six operative List I/II/III A/B values|V114
B78|2026-08-09|import match/skip controls did not require a visible officer explanation and run history omitted recorded reconciliation, actor, digest, and retry ancestry while presenting missing facts as zeros|V115
B79|2026-08-09|a legacy CSF Google connection could display a calendar-email field as chapter identity without verified user-info evidence, and disconnect/revoke outcomes did not give officers a truthful recovery path|V118
B80|2026-08-09|the canonical contract simultaneously promised timestamped Google compatibility tabs and prohibited every Google report-write destination even though the implemented report product is a local ZIP|V112
B81|2026-08-09|the accepted baseline can label a row scheduled without an accepted authorized due-post transition, so “Post scheduled” must not promise an automatic lifecycle until the in-progress publisher passes V120 acceptance|V120
B82|2026-08-09|point submission, proof, withdrawal, review, and appeal entrypoints did not consistently rederive current membership/policy/source/cap/proof authority at the database boundary|V121
B83|2026-08-09|operator instructions promised ten-minute announcement dispatch while the repository proved the durable ledger and worker route but contained no hosted scheduler configuration or invocation evidence|V35,V92
B84|2026-08-11|the hosted communications worker settled its delivery and attempt but never called the existing campaign terminalizer, leaving a one-recipient delivered campaign visibly stuck at Sending|V122
B85|2026-08-11|the duplicate-profile merge delegated reference rewrites to a July function that predated later profile FKs, omitted active point-claim collisions from preview, and used global account/cohort locks that serialized unrelated chapters and could deadlock with identity edits/claims|V123
B86|2026-08-11|the merge catalog labeled every sheet-import match mutable while the import freeze trigger pins every reviewed target, so a preview-ready merge delegated a blanket rewrite that failed with `55000` and had no frozen-row regression fixture|V124
