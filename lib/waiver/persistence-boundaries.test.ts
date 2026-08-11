import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readProjectActionSource } from "@/tests/support/project-action-source";

const ROOT = process.cwd();

function read(relativePath: string) {
  return readFileSync(`${ROOT}/${relativePath}`, "utf8");
}

test("anonymous waiver discovery is not exposed as an email oracle", () => {
  const actionSource = readProjectActionSource(ROOT);
  const formSource = read("app/projects/[id]/ProjectForm.tsx");

  assert.doesNotMatch(
    actionSource,
    /export async function checkReusableAnonymousWaiver/u,
  );
  assert.doesNotMatch(formSource, /checkReusableAnonymousWaiver/u);
  assert.match(actionSource, /verifyAnonymousSignupContinuation/u);
});

test("every supported signature mode persists its real evidence", () => {
  const actionSource = readProjectActionSource(ROOT);

  assert.match(actionSource, /signature_storage_path: signatureStoragePath/u);
  assert.match(actionSource, /upload_storage_path: uploadStoragePath/u);
  assert.match(actionSource, /signatureText\?\.trim\(\)/u);
  assert.doesNotMatch(actionSource, /signature_text:\s*params\.signerName/u);
  assert.match(actionSource, /\.eq\("project_id", params\.projectId\)/u);
});

test("signed uploads are read from the private evidence bucket", () => {
  for (const route of [
    "app/api/waivers/[signatureId]/preview/route.ts",
    "app/api/waivers/[signatureId]/download/route.ts",
  ]) {
    const source = read(route);
    assert.doesNotMatch(
      source,
      /\.from\(["']waiver-uploads["']\)\s*\n\s*\.download\(typedSignature\.upload_storage_path\)/u,
    );
    assert.match(
      source,
      /\.from\(["']waiver-signatures["']\)\s*\n\s*\.download\(typedSignature\.upload_storage_path\)/u,
    );
  }
});

test("public waiver lookup resolves project visibility before service-role definition access", () => {
  const source = readProjectActionSource(ROOT);
  const lookupStart = source.indexOf("export async function getProjectWaiver");
  const lookupEnd = source.indexOf(
    "export async function uploadProjectWaiverPdf",
    lookupStart,
  );
  const lookup = source.slice(lookupStart, lookupEnd);

  assert.match(lookup, /const supabase = await createClient\(\)/u);
  assert.match(lookup, /await supabase\s*\n\s*\.from\("projects"\)/u);
  assert.match(
    lookup,
    /await serviceSupabase\s*\n\s*\.from\("waiver_definitions"\)/u,
  );
  assert.match(lookup, /\.eq\("project_id", projectId\)/u);
});

test("waiver definition reads and versioned saves remain scoped to their project", () => {
  const source = readProjectActionSource(ROOT);
  const readStart = source.indexOf("export async function getWaiverDefinition");
  const saveStart = source.indexOf(
    "export async function saveWaiverDefinition",
    readStart,
  );
  const readFlow = source.slice(readStart, saveStart);
  const saveEnd = source.indexOf("export async function", saveStart + 30);
  const saveFlow = source.slice(
    saveStart,
    saveEnd === -1 ? undefined : saveEnd,
  );

  assert.match(
    readFlow,
    /\.eq\("id", project\.waiver_definition_id\)\s*\n\s*\.eq\("project_id", projectId\)/u,
  );
  assert.match(saveFlow, /waiverDefinitionInputSchema\.safeParse/u);
  assert.match(saveFlow, /save_project_waiver_definition_version/u);
  assert.match(saveFlow, /p_project_id: projectId/u);
  assert.doesNotMatch(
    saveFlow,
    /\.from\("waiver_definitions"\)\s*\n\s*\.update\(/u,
  );
});

test("registered signup captures its row id before waiver persistence and plugin hooks", () => {
  const orchestration = read("app/projects/[id]/server/signup.ts");
  const registeredFlow = read("app/projects/[id]/server/signup-registered.ts");

  assert.match(registeredFlow, /insertProjectSignupAtomically/u);
  assert.match(registeredFlow, /createdSignupId: insertedSignup\.id/u);
  assert.match(orchestration, /registerAuthenticatedSignup/u);
  assert.match(
    orchestration,
    /createdSignupId = registeredResult\.createdSignupId/u,
  );
  assert.doesNotMatch(orchestration, /else if \(user\)/u);

  const waiverStart = orchestration.indexOf(
    "if ((project.waiver_required || waiverSignature) && createdSignupId)",
  );
  const hooksStart = orchestration.indexOf(
    "if (project.organization_id && createdSignupId)",
    waiverStart,
  );
  assert.ok(waiverStart > orchestration.indexOf("registerAnonymousSignup"));
  assert.ok(hooksStart > waiverStart);
});

test("multi-slot waiver reuse copies evidence instead of sharing cleanup paths", () => {
  const source = readProjectActionSource(ROOT);
  const cloneStart = source.indexOf(
    "async function cloneAnonymousWaiverSignatureToSignup",
  );
  const cloneEnd = source.indexOf(
    "export async function togglePauseSignups",
    cloneStart,
  );
  const cloneFlow = source.slice(cloneStart, cloneEnd);

  assert.match(cloneFlow, /\.copy\(sourcePath, destinationPath\)/u);
  assert.match(cloneFlow, /cloned-waiver-evidence/u);
  assert.match(
    cloneFlow,
    /signature_storage_path: clonedSignatureStoragePath/u,
  );
  assert.match(cloneFlow, /upload_storage_path: clonedUploadStoragePath/u);
  assert.match(cloneFlow, /signature_payload: clonedSignaturePayload/u);
  assert.match(cloneFlow, /await removeCopiedEvidence\(\)/u);
});

test("signup cancellation and project deletion cannot erase signed evidence", () => {
  const source = readProjectActionSource(ROOT);
  const cancelStart = source.indexOf("export async function cancelSignup");
  const cancelEnd = source.indexOf("export async function", cancelStart + 30);
  const cancelFlow = source.slice(cancelStart, cancelEnd);
  const deleteStart = source.indexOf("export async function deleteProject");
  const deleteFlow = source.slice(deleteStart);

  assert.match(cancelFlow, /\.update\(\{ status: "cancelled" \}\)/u);
  assert.doesNotMatch(
    cancelFlow,
    /\.from\("project_signups"\)\s*\n\s*\.delete\(\)/u,
  );
  assert.match(deleteFlow, /from\("waiver_signatures"\)/u);
  assert.match(deleteFlow, /signed waivers must be cancelled and retained/u);
});
