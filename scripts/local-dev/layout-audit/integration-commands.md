# Owned Linux capture integration

The support code is implemented. Offline checks are not runtime acceptance. The historical root/private anchor remains `accba0cfc2cd2f880b5632f4535cea822947da94` / `38dc7c7aff6fd101c87f92eebfae822d1726f2b4`, with its immutable 723-migration object prefix unchanged. The combined candidate explicitly binds private `370c538d49d6dc1fc66d3435a13b1a5db14e82d2` (CSF 1.2.89 plus the dependency-only `apps/csf` repair) and exactly 740 migration objects: the historical prefix, fifteen joined forward migrations, the reviewed integration migration 739, and the calendar deletion fence 740. The source object-list digest is `ea324e71164f6b5f2be65792d080e33821bcd7554510aa9fc7598c208519defd`. Missing, reordered or altered objects still fail. This is source capture authorization only; it does not replace the accepted 740 database catalog, a clean replay, or runtime/browser/pixel proof.

## Source integration and job boundary

Keep the reviewed `scripts/local-dev/layout-audit/` files and their exact `code-manifest.sha256` hashes in the same frontend PR. Do not copy the original Mac package, external archive, generated `proof-data/`, offline scratch directories, authorization, passwords or runtime receipts. Run only through an opt-in `layout_audit` input/job in the existing `ci.yml`, with the final clean committed SHA as the checkout/GITHUB_SHA, `contents: read`, existing entitled private read key, `persist-credentials: false`, non-Main ref and one fresh job/stack. No new secret, scheduler, environment, provider or billing configuration is needed.

Reuse the current browser job's pinned checkout/setup actions, Node 24.21.0, Bun 1.4.2, Supabase 2.120.0, private gitlink checkout/metadata normalization, strict submodule check, frozen dependency installs, Chromium install, fresh `ci`+14 hex run ID, exact `/tmp/lets-assist-csf-browser-$CSF_ISOLATED_RUN_ID`, stack launcher, descriptor-validated 17-name app environment loader and masking. Reuse the owned replay/catalog/pgTAP checks; no shared or hosted seed. A final source input must name this frontend PR's committed descendant, not a dirty checkout, backend PR873 or a presumed current branch.

The normal launcher applies migrations and local SQL seed. **Do not run scale, Hours, other browser suites or any extra fixture seed in this capture job**: this package requires exactly the ordinary 22 actors and zero retained Hours actors. The later normal isolated platform seed is the sole JavaScript fixture writer here.

## Stage a private disposable helper copy

Run the offline suite before creating proof-data or enabling the observer. Never stage onto an existing directory.

```bash
set -euo pipefail
set +x
umask 077
cd "$GITHUB_WORKSPACE"
layout_tool="$GITHUB_WORKSPACE/.artifacts/layout-audit-tool/$CSF_ISOLATED_RUN_ID"
layout_support="$GITHUB_WORKSPACE/.artifacts/layout-audit-support/$CSF_ISOLATED_RUN_ID"
mkdir -p "$GITHUB_WORKSPACE/.artifacts/layout-audit-tool" "$GITHUB_WORKSPACE/.artifacts/layout-audit-support"
mkdir "$layout_tool" "$layout_support"
cp -R scripts/local-dev/layout-audit/. "$layout_tool/"
find "$layout_tool" -type d -exec chmod 700 {} +
find "$layout_tool" -type f -exec chmod 600 {} +
git check-ignore "$layout_tool/code-manifest.sha256" "$layout_support/authorization.json"
node "$layout_tool/linux-adapters.check.mjs"
```

The helper's checked `code-manifest.sha256` hash must equal the reviewed final package digest supplied in the handoff. Mode changes on this ignored copy preserve byte hashes and keep source clean. The offline suite uses temporary synthetic rows/events/files and deletes them. It cannot issue a live binding or perform network/stack/kernel observations.

## Root-reviewed source authorization

Place an owner-only, new `$layout_support/authorization.json` containing these fields. This is the root's actual source review input, **not a runtime/fixture receipt**:

```json
{
  "schema": "lets-assist-layout-linux-authorization-v1",
  "template": false,
  "reviewed": true,
  "rootHead": "<exact final GITHUB_SHA>",
  "privateHead": "370c538d49d6dc1fc66d3435a13b1a5db14e82d2",
  "repoRoot": "<real GITHUB_WORKSPACE>",
  "workDir": "<exact canonical owned CSF_ISOLATED_WORK_DIR>",
  "codeManifestSha256": "<reviewed portable/code-manifest.sha256 SHA256>",
  "reviewedSourceHashes": {},
  "captureTemplateFile": "<owner-only reviewed scene template in staged helper or support directory>",
  "reviewedCaptureTemplateSha256": "<actual reviewed scene-template SHA256>"
}
```

An empty `reviewedSourceHashes` approves **no changed proof sources**. Unchanged files must match original reviewed hashes. Add only specifically rereviewed files with their exact final bytes (routing/static images, title/cache implementation, app profile reader or the four optional read actions). Installed dependency targets may resolve inside the exact root/private `node_modules`; tracked app/public paths cannot be symlinked. Do not automatically fill a changed file's hash and call that review. The template may retain the 87 original scene IDs or an explicit subset; altered route/loaded landmark/role assignments need root source review. All four modes are automatic. Optional reduced motion uses `captureReducedMotion: true` on reviewed entries.

Run setup against the **already started owned stack**:

```bash
node "$layout_tool/prepare-linux-binding.mjs" "$layout_support/authorization.json" "$layout_support/linux-binding.json"
export LETS_ASSIST_LAYOUT_BINDING="$layout_support/linux-binding.json"
node "$layout_tool/seal-fixture-password.mjs" --create-owned-local-password
layout_fixture_password="$(cat "$CSF_ISOLATED_WORK_DIR/csf-local-test-password")"
printf '::add-mask::%s\n' "$layout_fixture_password"
export CSF_LOCAL_TEST_PASSWORD="$layout_fixture_password"
unset layout_fixture_password
bun run csf:seed:platform:isolated
node "$layout_tool/collect-fixture-proof.mjs" "$layout_support/fixture-proof.json"
node "$layout_tool/prepare-observer.mjs" --enable-observer "$CSF_ISOLATED_RUN_ID" "$layout_support/observer-opt-in.json"
```

Do not use the browser job's old deterministic password: the sealed file and this seed must use the same run-scoped value. Do not run bootstrap/password replacement. The read-only collector validates actual loopback Auth users/profiles and two project creator mappings, actual owned marker/project/volume, exact metadata/null phones and source roles; only those observed 22 UUIDs can sign in. No suffix-based fiction rule is allowed.

## Canonical build/launch, proof, capture

Run this as **one job shell step** so the shell owns the canonical runner until captures end. The observer preload is per-command; do not export NODE_OPTIONS or the opt-in globally. Canonical child builds/start continue receiving the repository's exact cron egress guard. No Next/Bun dev fallback, alternate runtime, port adoption or build reuse.

```bash
layout_runner_pid=''
layout_stop_runner() {
  if [[ -n "$layout_runner_pid" ]]; then
    # Only the running child job created by this same shell is signalled.
    layout_running_child=false
    while IFS= read -r pid; do
      if [[ "$pid" == "$layout_runner_pid" ]]; then layout_running_child=true; fi
    done < <(jobs -pr)
    if [[ "$layout_running_child" == true ]]; then
      kill -TERM "$layout_runner_pid" 2>/dev/null || true
    fi
    wait "$layout_runner_pid" || true
  fi
}
trap layout_stop_runner EXIT INT TERM
NODE_OPTIONS="--require $layout_tool/capture-spawn-observer.cjs" \
LETS_ASSIST_LAYOUT_SPAWN_OBSERVER_OPT_IN="$layout_support/observer-opt-in.json" \
CSF_BROWSER_SERVER_MODE=production CSF_ISOLATED_APP_PORT=3000 \
node scripts/local-dev/run-dvhs-csf-isolated-app.mjs &
layout_runner_pid=$!
layout_spawn="$GITHUB_WORKSPACE/.artifacts/layout-audit-spawn/$CSF_ISOLATED_RUN_ID"
layout_deadline=$((SECONDS + 1200))
while [[ ! -f "$layout_spawn/canonical-next-spawn.json" ]]; do
  [[ ! -f "$layout_spawn/observer-failure.json" ]] || exit 1
  kill -0 "$layout_runner_pid" 2>/dev/null || exit 1
  (( SECONDS < layout_deadline )) || exit 1
  sleep 2
done
# The collector verifies all FOUR exclusive events, actual listener readiness,
# source/build/stack/claim identity, full worker bytes and root/private served chunks.
# A spawn event alone is not HTTP readiness. Retry this read-only collector ONLY
# while readiness has not produced any output; never erase an existing receipt.
layout_deadline=$((SECONDS + 60))
until node "$layout_tool/collect-runtime-proof.mjs" \
  "$layout_support/observer-opt-in.json" "$layout_support/fixture-proof.json" \
  "$layout_support" "$CSF_ISOLATED_RUN_ID" --enable-reviewed-read-actions; do
  [[ ! -e "$layout_support/runtime-binding.json" && ! -e "$layout_support/capture-manifest.json" ]] || exit 1
  [[ ! -d "$GITHUB_WORKSPACE/.artifacts/layout-audit/$CSF_ISOLATED_RUN_ID" ]] || exit 1
  kill -0 "$layout_runner_pid" 2>/dev/null || exit 1
  (( SECONDS < layout_deadline )) || exit 1
  sleep 2
done
node "$layout_tool/capture.mjs" "$layout_support/capture-manifest.json"
```

Remove the optional `--enable-reviewed-read-actions` flag if the named source paths and compiled mappings have not been reviewed. Without it, affected pages remain explicitly blocked. With it, only the three platform readers, two invitation readers, two disconnected integration readers, the initial `getOrganizationPluginSettings` getter, and the exact `project-creator` attendee projection RPC are permitted. Server actions require exact compiled IDs, workers, source snapshots and their independently observed fictional actor/project or organization authority. The attendee RPC additionally requires the proved creator, project, fresh actor token, exact local endpoint and JSON argument. Requests remain bounded; all other RPCs, plugin install, configuration, runtime selection, update, uninstall and data deletion stay refused. There is no generic POST allowance.

SIGTERM is handled by the canonical supervisor's existing owned-child teardown, including the fixed asynchronous build path and unchanged deadline. Do not kill processes by title/port. The support collectors bind successful observed build exits, actual PID/startTicks/boot/UID/executable/cwd/direct parent, actual socket inode/loopback, exact nonsensitive argv/environment, root/private full artifacts and served BUILD_ID bytes. They do not manufacture Linux birthtimes. The exact source-bound Next title replacement requires the successful contemporaneous spawn event; a title alone grants nothing.

## Upload only capture evidence; always clean up

Use the existing pinned `actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a`, seven-day retention, after validating this exact new output directory. Upload only:

- `$GITHUB_WORKSPACE/.artifacts/layout-audit/$CSF_ISOLATED_RUN_ID/capture-results.json`
- the same directory's `capture-results.jsonl`
- that directory's explicit scene-ID + reviewed-mode `.png` names present in the result rows (no other files)

Each PNG name must equal `<known scene id>-<desktop-light|desktop-dark|phone-light|phone-dark|desktop-light-reduced>.png`; mode/scene must exist in the actual manifest, file must be owner-only/regular/non-symlink, no path separators/dot segments/collisions, and the PNG signature must be valid. Results are the capture code's sanitized schema/counters; no raw DOM/user/exception/URL/action/cookie frame logs. A successful PNG remains **awaiting pixel review**, not a completed audit. A `captured-loading-present` image is not loaded interior evidence.

Do not glob-upload `.artifacts`, helper/support/stack work directories, `proof-data`, Auth/profile exports, env/passwords, browser state/traces, stdout dumps, DB or compiled `.next`. Generate the action path output using the implemented validator, before the shell's owned runner teardown (it also works on a partial capture's exclusive final results):

```bash
if [[ -f "$layout_support/capture-manifest.json" ]]; then
  layout_upload_paths="$(node "$layout_tool/validate-upload-list.mjs" "$layout_support/capture-manifest.json")"
  {
    printf 'paths<<LAYOUT_OWNED_FILES\n'
    printf '%s\n' "$layout_upload_paths"
    printf 'LAYOUT_OWNED_FILES\n'
  } >> "$GITHUB_OUTPUT"
fi
```

Set the shell step `id: layout-capture`, then the pinned upload action's `path: ${{ steps.layout-capture.outputs.paths }}` and `if: ${{ always() && steps.layout-capture.outputs.paths != '' }}`. Do not upload a directory or wildcard. If no validated capture receipt exists, upload nothing; report the blocked phase in normal job metadata. In the final workflow, preserve the capture exit status while still running this validator; a guard failure must not become a green job.

Use a final workflow step with `if: always()` for exact stack cleanup after the canonical runner shell exits:

```bash
if [[ -n "${CSF_ISOLATED_WORK_DIR:-}" && -d "$CSF_ISOLATED_WORK_DIR" ]]; then
  scripts/local-dev/stop-dvhs-csf-isolated-stack.sh --delete-workdir "$CSF_ISOLATED_WORK_DIR"
fi
```

The existing stop script validates the exact marker/project/ports/volume and removes only its namespace after residual checks. No global Docker prune, reset, restart or provider cleanup. Preserve only the validated capture artifacts before deleting ephemeral secrets/fixture runtime.

## Honest coverage boundary

The template has 87 source candidates / 348 four-mode planned captures, not a guarantee of 87 loaded screens. It stops at the first guard/readiness failure; every result keeps its actual status. If one known missing fixture blocks a batch, root may author and review a separate template subset, leaving that scene in the outstanding ledger, and start a **fresh** owned output/job. Do not silently drop, weaken landmarks or recast a denial/redirect/error/loading state as an interior.

Ordinary source seeds do not prove AAL2/MFA factors, public/private token and waiver acceptance surfaces, all certificates/QR/retired join-code cases, populated drafts, landing demo ON/OFF, controlled loading/error states or every private CSF role interior. These require their exact existing approved fictional fixture contracts or remain blocked. This package does not create them or invoke business actions. The private app is fully artifact-bound but has no new private runtime cache exclusion; a legitimate private cache write can stop verification and needs source-specific review. Unknown remote images, unsafe GET/provider links, unreviewed read actions and private traffic remain blocked. Old counterpart matches and personal references are not invented or published. Root and actual Claude Opus 5.5 inspect authentic resulting pixels and record reviewed coverage separately.
