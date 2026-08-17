§G

DVHS CSF officer UX → class-first Home → Classes → Applications → More; class workspace → Stream → Members → Activities → Submissions.

§C

- Base root `fe749b3d`; private gitlink `e9e86fe4`; Production ⊥.
- UI says `Class`; existing `cohort` schema identifiers stay.
- Stable profile + graduation class; term application/import alone activates term membership.
- Public organization page exposes join/claim entry only; class Stream/Activities/membership content requires authenticated authorized class access.
- Meetings chapter-wide under More; member dashboard visual model preserved.
- Real student data, attached source rows, secrets, provider sends, hosted mutation ⊥.
- Synthetic fixtures stay isolated local/CI; hosted fixture leakage ⊥.
- Imports keep source identity, explicit tab/range/mapping, immutable preview, reconciliation, auth recheck, atomic commit.
- Private plugin commits precede root gitlink update.

§I

route: officer top nav → `Home | Classes | Applications | More`
route: class workspace → `cohorts/<cohortId>/<stream|members|activities|submissions>` + URL term state
route: legacy `points|meetings|verification` → compatible destination mapping
route: public organization → class cards → join code + sign-in/claim flow
service: class loader → explicit `{organizationId, cohortId, termId}`
service: public class loader → safe class identity + join eligibility metadata only
db: stable class join code → organization + cohort + code digest + lifecycle; direct invitations unchanged
cmd: `bun run test:plugins`; `bun run typecheck`; `bun run lint`; `bun run db:validate`; focused pgTAP; `bun run build`

§V

V1: ∀ officer shell → exact top nav Home, Classes, Applications, More; duplicate Members/Service top destinations ⊥.
V2: ∀ class workspace → exact tabs Stream, Members, Activities, Submissions + explicit URL term; current term default.
V3: class member count/list → selected term participation only by default; chapter directory total substitution ⊥.
V4: stable profile + class link survive term change; term membership requires accepted application or committed roster import.
V5: class code → one active permanent code/class, owner rotate/revoke, no automatic term membership, exact verified-email match only; name-only match ⊥.
V6: public class payload → safe class identity + join entry only; Stream, Activities, terms, rosters, codes, comments, applications, submissions, proof, points, attendance, account state ⊥.
V7: class Stream/Activities read → authenticated authorized class member/officer only; draft/archived remain scoped; publication permission rechecked server-side.
V8: class Activities → class-targeted + chapter-wide records without duplication.
V9: class Submissions → selected class/term queues + existing review detail/range assignment; user-facing `Verification` destination ⊥.
V10: Meetings → one chapter-wide More workspace; class page mutation copy ⊥.
V11: Applications → one chapter inbox + current-term default + class/status/assignee filters; Appeals nested; decision email explicit separate confirmation.
V12: contextual import start → Applications, class Members, or Partner clubs; More Import history starts no duplicate generic flow.
V13: class/public loaders → route-required fields only; public loader never reuses privileged projection.
V14: new SQL function → explicit revoke/grant + reviewed role allowlist; tenant + actor permission rechecked under lock.
V15: fixture seed → isolated local/CI target proof; hosted Development/Production target ⊥.
V16: old CSF deep links retain compatible redirect/mapping during migration.
V17: no real attached row value enters migration, fixture, test, screenshot, log, prompt, or committed artifact.
V18: private feature implementation may use `codex/*`; strict branch containment runs only after private commit merges to private `development` + root gitlink advances.

§T

id|status|task|cites
T1|x|baseline merged root/private tree + encode approved class-first contract|V17,I.cmd
T2|x|replace officer nav + Home + class shell/tabs/term state + compatibility mapping|V1,V2,V9,V10,V16,I.route,I.service
T3|x|build term-aware class Members, Activities, Submissions + contextual imports/review queues|V2,V3,V4,V8,V9,V12,V13,I.route,I.service
T4|x|add permanent class-code schema/actions/UI + exact identity/term-membership boundaries|V4,V5,V14,V17,I.db,I.service
T5|x|add safe public class cards/Stream/Activities + publication contracts|V6,V7,V13,V17,I.route,I.service
T6|~~|consolidate Applications/Appeals/Meetings/More + remove redundant entry points|V1,V10,V11,V12,V16,I.route
T7|~~|harden fixture target fences + add DB/unit/component/browser/privacy coverage|V3,V4,V5,V6,V7,V8,V9,V11,V12,V13,V14,V15,V16,V17,I.cmd
T8|~|run full gates, commit private first, merge/checkout private development, advance root gitlink, record exact evidence|V14,V15,V17,V18,I.cmd
T9|.|replace public class content with join/sign-in/claim flow + authenticated class-content authorization|V4,V5,V6,V7,V13,V14,V16,V17,I.route,I.service,I.db

§B

id|date|cause|fix
B1|2026-08-16|strict containment invoked before private feature implementation/promotion|V18
B2|2026-08-16|private PR #53 requires independent approval; auto-merge is disabled and branch protection was not bypassed|V18
