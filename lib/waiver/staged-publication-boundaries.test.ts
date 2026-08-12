import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const creation = read("app/projects/create/server/create.ts");
const drafts = read("app/projects/create/server/drafts.ts");
const barrel = read("app/projects/create/actions.ts");
const creator = read("app/projects/create/ProjectCreator.tsx");
const migration = read(
  "supabase/migrations/20260811200000_waiver_signup_and_publication_integrity.sql",
);

describe("staged waiver project creation", () => {
  test("a waiver project is inserted unpublished, whatever the client claims", () => {
    expect(creation).toMatch(
      /const stagesWaiverPublication = !isDraft && !!projectData\.waiverRequired;/u,
    );
    expect(creation).toMatch(
      /workflow_status:\s*\n?\s*isDraft \|\| stagesWaiverPublication \? "draft" : "published"/u,
    );
  });

  test("the client marker is never treated as the uploaded document", () => {
    const insertBlock = creation.slice(
      creation.indexOf("const baseProjectPayload = {"),
      creation.indexOf("const projectInsertPayloads = ["),
    );
    expect(insertBlock).not.toContain("waiverPdfFile");
    expect(insertBlock).not.toContain("waiver_pdf_storage_path");
    expect(insertBlock).not.toContain("waiver_pdf_url");
  });

  test("non-waiver creation still publishes immediately", () => {
    expect(creation).toMatch(/requiresWaiverPublication\?: boolean;/u);
    expect(creation).toMatch(
      /\.\.\.\(stagesWaiverPublication \? \{ requiresWaiverPublication: true \} : \{\}\)/u,
    );
    expect(drafts).toMatch(
      /requiresWaiverPublication: basicResult\.requiresWaiverPublication \?\? false/u,
    );
  });
});

describe("staged waiver project publication", () => {
  test("publication is a server action that proves the actor from the session", () => {
    const action = creation.slice(
      creation.indexOf("export async function publishWaiverStagedProject"),
    );
    expect(action).toMatch(/\{\s*"use server";/u);
    expect(action).toMatch(/await supabase\.auth\.getUser\(\)/u);
    expect(action).toMatch(/"publish_waiver_staged_project"/u);
    expect(action).toMatch(/p_actor_id: user\.id/u);
    expect(barrel).toContain("publishWaiverStagedProject");
  });

  test("a repeated finalize converges instead of reporting a new project", () => {
    const action = creation.slice(
      creation.indexOf("export async function publishWaiverStagedProject"),
    );
    expect(action).toMatch(/result\.outcome === "already_published"/u);
    expect(action).toMatch(/alreadyPublished: true/u);
  });

  test("no refusal reason leaks raw provider text", () => {
    const action = creation.slice(
      creation.indexOf("export async function publishWaiverStagedProject"),
    );
    expect(action).not.toMatch(/error\.message|error\.details|error\.hint/u);
    expect(action).toMatch(/WAIVER_PUBLICATION_MESSAGES\[result\.outcome\]/u);
  });

  test("every database refusal outcome has a mapped message", () => {
    const outcomes = [
      "project_not_found",
      "forbidden",
      "not_waiver_project",
      "invalid_state",
      "missing_waiver_source",
      "missing_storage_object",
      "missing_waiver_definition",
      "definition_source_mismatch",
      "definition_missing_signature_field",
      "no_signing_mode",
      "invalid_input",
    ];

    for (const outcome of outcomes) {
      expect(migration).toContain(`outcome := '${outcome}'`);
      expect(creation).toContain(`${outcome}:`);
    }
  });
});

describe("creation client retry state", () => {
  test("a failed publication is reported as unpublished, not as success", () => {
    const submit = creator.slice(
      creator.indexOf("const handleSubmit = async () => {"),
      creator.indexOf("const handleSaveDraft = async () => {"),
    );

    const failureIndex = submit.indexOf("if (publicationError) {");
    expect(failureIndex).toBeGreaterThan(0);
    const successIndex = submit.indexOf("Project Created Successfully!");
    expect(successIndex).toBeGreaterThan(failureIndex);

    const failureBlock = submit.slice(failureIndex, failureIndex + 600);
    expect(failureBlock).toMatch(/toast\.error\(publicationError/u);
    expect(failureBlock).toMatch(/not published yet/u);
    expect(failureBlock).toMatch(/return;/u);
  });

  test("a retry finishes the staged row instead of creating another project", () => {
    expect(creator).toMatch(
      /const stagedProjectIdRef = useRef<string \| null>\(null\);/u,
    );
    expect(creator).toMatch(/let projectId = stagedProjectIdRef\.current;/u);
    expect(creator).toMatch(/stagedProjectIdRef\.current = projectId;/u);
    expect(creator).toMatch(/stagedProjectIdRef\.current = null;/u);
  });

  test("the client asks the server to publish rather than assuming it", () => {
    expect(creator).toMatch(/await publishWaiverStagedProject\(projectId\)/u);
    expect(creator).toMatch(/await completeWaiverPublication\(projectId\)/u);
  });
});

describe("publication database contract", () => {
  test("the storage proof and publication stay service-role only", () => {
    for (const signature of [
      "public.publish_waiver_staged_project(uuid, uuid)",
      "private.waiver_source_object_exists(text, text)",
      "private.insert_project_signup_locked(\n  uuid, text, uuid, uuid, text, text, jsonb, jsonb, jsonb\n)",
    ]) {
      expect(migration).toContain(`REVOKE ALL ON FUNCTION ${signature}`);
    }
    expect(migration).not.toMatch(
      /GRANT EXECUTE ON FUNCTION private\.[a-z_]+\([^)]*\)\s*\n?\s*TO[^;]*authenticated/u,
    );
  });

  test("a missing storage catalog raises instead of proving existence", () => {
    expect(migration).toMatch(
      /IF to_regclass\('storage\.objects'\) IS NULL THEN\s+RAISE EXCEPTION/u,
    );
  });

  test("an e-signature project cannot publish without a matching definition", () => {
    expect(migration).toMatch(
      /IF v_esignature_enabled AND v_project\.waiver_definition_id IS NULL THEN/u,
    );
    expect(migration).toMatch(
      /v_definition\.pdf_storage_path IS DISTINCT FROM\s+v_project\.waiver_pdf_storage_path/u,
    );
    expect(migration).toMatch(
      /field->>'field_type' IN \('signature', 'initial'\)/u,
    );
  });

  test("an unpublished project is not signable and consumes no capacity", () => {
    expect(migration).toMatch(
      /IF COALESCE\(v_project\.workflow_status, 'published'\) <> 'published' THEN\s+outcome := 'project_unpublished';/u,
    );
  });
});

describe("draft publication cannot strand a staged waiver project", () => {
  test("publishing a stored draft refuses waiver projects before creating a row", () => {
    const publish = drafts.slice(
      drafts.indexOf("export async function publishDraft"),
      drafts.indexOf("export async function updateDraft"),
    );

    const guardIndex = publish.indexOf("projectData?.waiverRequired");
    const createIndex = publish.indexOf("createBasicProject(");
    expect(guardIndex).toBeGreaterThan(0);
    expect(createIndex).toBeGreaterThan(guardIndex);
    expect(publish).toMatch(/must be published from the create flow/u);
  });
});
