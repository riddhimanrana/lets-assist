#!/usr/bin/env bash
# Run only in the opted-in existing CI job, after its canonical owned stack/env.
set -euo pipefail
set +x
umask 077
[[ "${GITHUB_ACTIONS:-}" == true && "${GITHUB_REPOSITORY:-}" == riddhimanrana/lets-assist && "${GITHUB_REF:-}" != refs/heads/main ]]
[[ "${CSF_ISOLATED_RUN_ID:-}" =~ ^ci[a-f0-9]{14}$ ]]
[[ "${CSF_ISOLATED_WORK_DIR:-}" == "/tmp/lets-assist-csf-browser-$CSF_ISOLATED_RUN_ID" ]]
[[ "${LAYOUT_AUDIT_CODE_MANIFEST_SHA256:-}" =~ ^[a-f0-9]{64}$ ]]
cd "$GITHUB_WORKSPACE"
[[ "$(pwd -P)" == "$GITHUB_WORKSPACE" && "$(git rev-parse HEAD)" == "$GITHUB_SHA" ]]
layout_tool="$GITHUB_WORKSPACE/.artifacts/layout-audit-tool/$CSF_ISOLATED_RUN_ID"
layout_support="$GITHUB_WORKSPACE/.artifacts/layout-audit-support/$CSF_ISOLATED_RUN_ID"
mkdir -p "$GITHUB_WORKSPACE/.artifacts/layout-audit-tool" "$GITHUB_WORKSPACE/.artifacts/layout-audit-support"
mkdir "$layout_tool" "$layout_support"
cp -R scripts/local-dev/layout-audit/. "$layout_tool/"
find "$layout_tool" -type d -exec chmod 700 {} +
find "$layout_tool" -type f -exec chmod 600 {} +
git check-ignore "$layout_tool/code-manifest.sha256" "$layout_support/authorization.json"
[[ "$(sha256sum "$layout_tool/code-manifest.sha256" | cut -d ' ' -f 1)" == "$LAYOUT_AUDIT_CODE_MANIFEST_SHA256" ]]
node "$layout_tool/linux-adapters.check.mjs"
# Root authorized only reordering the original87 scenes, not altering landmarks.
node --input-type=module - "$layout_tool" "$layout_support" <<'NODE'
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
const [tool,support]=process.argv.slice(2),digest=b=>createHash('sha256').update(b).digest('hex');
const source=JSON.parse(fs.readFileSync(path.join(tool,'upstream/manifest.baseline-template.json')));
const rank=e=>e.id==='landing-baseline'?0:e.id==='home-member'?1:e.id.startsWith('dashboard-')?2:e.id.startsWith('organization')?3:4;
source.captures=source.captures.map((entry,index)=>({entry,index})).sort((a,b)=>rank(a.entry)-rank(b.entry)||a.index-b.index).map(v=>v.entry);
const file=path.join(support,'ordered-scene-template.json'),bytes=JSON.stringify(source,null,2)+'\n';fs.writeFileSync(file,bytes,{mode:0o600,flag:'wx'});
const authorization={schema:'lets-assist-layout-linux-authorization-v1',template:false,reviewed:true,rootHead:process.env.GITHUB_SHA,privateHead:'38dc7c7aff6fd101c87f92eebfae822d1726f2b4',repoRoot:process.env.GITHUB_WORKSPACE,workDir:process.env.CSF_ISOLATED_WORK_DIR,codeManifestSha256:process.env.LAYOUT_AUDIT_CODE_MANIFEST_SHA256,reviewedSourceHashes:{'hooks/useUserProfile.ts':'aa7837619294779965a8fcac375f7e6fba8923e6e4a412854c1fd055f23252ce','components/layout/Navbar.tsx':'8c9ca8fa2754a923a92870a985a6d4f7a256e5ea310acb8871ec3f5c61f18808'},captureTemplateFile:file,reviewedCaptureTemplateSha256:digest(Buffer.from(bytes))};
fs.writeFileSync(path.join(support,'authorization.json'),JSON.stringify(authorization)+'\n',{mode:0o600,flag:'wx'});
NODE
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
layout_runner_pid=''
layout_stop_runner() {
  layout_exit_status=$?
  trap - EXIT INT TERM
  if [[ -n "$layout_runner_pid" ]]; then
    layout_running_child=false
    while IFS= read -r pid; do
      if [[ "$pid" == "$layout_runner_pid" ]]; then layout_running_child=true; fi
    done < <(jobs -pr)
    if [[ "$layout_running_child" == true ]]; then kill -TERM "$layout_runner_pid" 2>/dev/null || true; fi
    wait "$layout_runner_pid" || true
  fi
  exit "$layout_exit_status"
}
trap layout_stop_runner EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# /proc keeps the original launch strings; Node normalizes process.argv.
# Use the binding's exact real executable so both independent witnesses agree.
layout_node="$(node - "$layout_tool" <<'NODE'
const fs = require('node:fs'), path = require('node:path');
const tool = process.argv[2], binding = require(path.join(tool, 'linux-binding.cjs'));
const os = require(path.join(tool, 'linux-platform.cjs')), b = binding.live(binding.load());
for (const identity of [b.node, b.script]) {
  const st = fs.lstatSync(identity.path);
  if (!st.isFile() || st.isSymbolicLink() || fs.realpathSync(identity.path) !== identity.path || os.hash(fs.readFileSync(identity.path)) !== identity.sha256) os.deny();
}
process.stdout.write(b.node.path);
NODE
)"
NODE_OPTIONS="--require $layout_tool/capture-spawn-observer.cjs" \
LETS_ASSIST_LAYOUT_SPAWN_OBSERVER_OPT_IN="$layout_support/observer-opt-in.json" \
CSF_BROWSER_SERVER_MODE=production CSF_ISOLATED_APP_PORT=3000 \
"$layout_node" "$GITHUB_WORKSPACE/scripts/local-dev/run-dvhs-csf-isolated-app.mjs" &
layout_runner_pid=$!
layout_spawn="$GITHUB_WORKSPACE/.artifacts/layout-audit-spawn/$CSF_ISOLATED_RUN_ID"
layout_deadline=$((SECONDS + 1200))
while [[ ! -f "$layout_spawn/canonical-next-spawn.json" ]]; do
  [[ ! -f "$layout_spawn/observer-failure.json" ]] || exit 1
  kill -0 "$layout_runner_pid" 2>/dev/null || exit 1
  (( SECONDS < layout_deadline )) || exit 1
  sleep 2
done
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
set +e
node "$layout_tool/capture.mjs" "$layout_support/capture-manifest.json"
layout_capture_status=$?
set -e
# Never turn guard/landmark failures green; a partial exclusive receipt may upload.
layout_upload_paths="$(node "$layout_tool/validate-upload-list.mjs" "$layout_support/capture-manifest.json")"
{
  printf 'paths<<LAYOUT_OWNED_FILES\n'
  printf '%s\n' "$layout_upload_paths"
  printf 'LAYOUT_OWNED_FILES\n'
} >> "$GITHUB_OUTPUT"
exit "$layout_capture_status"
