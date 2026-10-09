import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const creator = read("app/projects/create/ProjectCreator.tsx");
const draftsPage = read("app/projects/drafts/DraftsClient.tsx");
const validation = read("app/projects/create/use-step-validation.ts");

describe("waiver publication can be retried", () => {
  const publication = creator.slice(
    creator.indexOf("const completeWaiverPublication = async ("),
    creator.indexOf("const handleSubmit = async () => {"),
  );

  test("the signature placements are saved outside the one-time upload", () => {
    const uploadGuard = publication.indexOf(
      "if (state.waiverPdfFile && !attempt.waiverAttached) {",
    );
    const attached = publication.indexOf("attempt.waiverAttached = true;");
    const definitionGuard = publication.indexOf(
      "if (state.waiverDefinition) {",
    );
    const save = publication.indexOf("await saveWaiverDefinition(");
    const publish = publication.indexOf(
      "await publishWaiverStagedProject(projectId)",
    );

    expect(uploadGuard).toBeGreaterThan(0);
    // The upload block closes before the definition is considered, so a retry
    // that already attached its PDF still saves a definition configured since.
    expect(attached).toBeGreaterThan(uploadGuard);
    expect(definitionGuard).toBeGreaterThan(attached);
    expect(save).toBeGreaterThan(definitionGuard);
    expect(publish).toBeGreaterThan(save);
    expect(
      publication.slice(uploadGuard, attached).includes("saveWaiverDefinition"),
    ).toBe(false);
  });

  test("Create is blocked, with its reason, while the waiver is not ready", () => {
    expect(creator).toContain(
      "const waiverBlockedReason = getWaiverStepError(state);",
    );
    expect(creator).toMatch(
      /state\.step === finalStep && Boolean\(waiverBlockedReason\)/u,
    );
    expect(creator).toMatch(/blockedReason=\{/u);
  });
});

describe("the settings step checks the waiver", () => {
  test("step 4 does not pass while the waiver is not ready", () => {
    expect(validation).toContain(
      "const waiverValid = getWaiverStepError(state) === null;",
    );
    expect(validation).toContain("return issues.length === 0 && waiverValid;");
  });

  test("an organization plugin step can be continued past", () => {
    expect(validation).toContain("return state.step <= finalStep;");
  });
});

describe("saved drafts reopen in the create flow", () => {
  test("no link treats a draft id as a project id", () => {
    expect(draftsPage).not.toMatch(/\/projects\/\$\{draft\.id\}\/edit/u);
    expect(draftsPage).toContain("/projects/create?draft=");
    expect(
      draftsPage.match(/href=\{draftEditorHref\(draft\.id\)\}/gu),
    ).toHaveLength(3);
  });
});
