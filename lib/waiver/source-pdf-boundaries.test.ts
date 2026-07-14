import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ROOT = process.cwd();

function read(relativePath: string) {
  return readFileSync(`${ROOT}/${relativePath}`, "utf8");
}

test("PDF rendering never performs network access", () => {
  const renderer = read("lib/waiver/generate-signed-waiver-pdf.ts");

  assert.doesNotMatch(renderer, /\bfetch\s*\(/u);
  assert.doesNotMatch(renderer, /waiverPdfUrl/u);
  assert.match(renderer, /sourcePdfBytes/u);
});

test("preview and download load source PDFs through the bounded server loader", () => {
  for (const route of [
    "app/api/waivers/[signatureId]/preview/route.ts",
    "app/api/waivers/[signatureId]/download/route.ts",
  ]) {
    const source = read(route);
    assert.match(source, /loadWaiverSourcePdf/u);
    assert.match(source, /waiver_pdf_storage_path/u);
    assert.match(source, /pdf_storage_path/u);
    assert.match(source, /sourcePdfBytes/u);
    assert.doesNotMatch(source, /generateSignedWaiverPdf\(\{\s*waiverPdfUrl/u);
    assert.doesNotMatch(source, /NextResponse\.redirect\(typedSignature\.signature_file_url\)/u);
  }
});

test("signatures snapshot source paths and definition saves are version-on-write", () => {
  const actions = read("app/projects/[id]/actions.ts");

  assert.match(actions, /waiver_pdf_storage_path: waiverPdfStoragePath/u);
  assert.match(actions, /save_project_waiver_definition_version/u);
  assert.doesNotMatch(
    actions.slice(actions.indexOf("export async function saveWaiverDefinition")),
    /\.from\("waiver_definitions"\)\s*\n\s*\.update\(/u,
  );
  assert.match(actions, /Failed to verify waiver source retention references/u);
});

test("database source-path constraints use exact project prefixes", () => {
  const migration = read(
    "supabase/migrations/20260712020512_enforce_waiver_source_project_scope.sql",
  );

  assert.match(migration, /left\(/u);
  assert.doesNotMatch(migration, /storage_path LIKE/u);
  assert.match(migration, /waiver_signatures_pdf_storage_path_project_scope_check/u);
});
