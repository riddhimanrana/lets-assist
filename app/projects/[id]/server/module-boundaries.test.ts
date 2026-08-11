import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const serverDirectory = import.meta.dir;
const barrelPath = join(serverDirectory, "../actions.ts");
const barrelSource = readFileSync(barrelPath, "utf8");
const implementationFiles = readdirSync(serverDirectory)
  .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
  .sort();

const PUBLIC_ACTIONS = [
  "canCurrentUserManageProject",
  "cancelSignup",
  "checkInParticipant",
  "checkOutParticipant",
  "cloneProject",
  "createRejectionNotification",
  "deleteProject",
  "getAnonymousWaiverSignatureMeta",
  "getCreatorProfile",
  "getCurrentUserProjectPermissions",
  "getMyProjectFeedback",
  "getMyWaiverSignatures",
  "getProject",
  "getProjectFeedbackSummary",
  "getProjectWaiver",
  "getUserProfile",
  "getWaiverDefinition",
  "getWaiverDownloadUrl",
  "isProjectCreator",
  "removeProjectWaiverPdf",
  "resendAnonymousConfirmationEmail",
  "saveWaiverDefinition",
  "signUpForProject",
  "submitProjectFeedback",
  "submitProjectFeedbackWithToken",
  "togglePauseSignups",
  "unrejectSignup",
  "updateProject",
  "updateProjectStatus",
  "uploadProjectWaiverPdf",
] as const;

function exportedNames(source: string) {
  return [...source.matchAll(/export\s*\{([\s\S]*?)\}\s*from/gu)]
    .flatMap((match) => match[1].split(","))
    .map((name) => name.trim())
    .filter(Boolean)
    .sort();
}

describe("project action module boundaries", () => {
  test("preserves the complete public action surface through the compatibility barrel", () => {
    expect(exportedNames(barrelSource)).toEqual([...PUBLIC_ACTIONS].sort());
    expect(barrelSource).not.toContain('"use server"');
    expect(barrelSource).not.toContain("getAdminClient(");
    expect(barrelSource).not.toContain('.from("');
  });

  test("keeps every implementation module within the service/action budget", () => {
    const oversized = implementationFiles.flatMap((file) => {
      const source = readFileSync(join(serverDirectory, file), "utf8");
      const lines = source.split("\n").length - (source.endsWith("\n") ? 1 : 0);
      return lines > 800 ? [`${file}:${lines}`] : [];
    });

    expect(oversized).toEqual([]);
  });

  test("marks each public implementation with its own server-action boundary", () => {
    const implementationSource = implementationFiles
      .map((file) => readFileSync(join(serverDirectory, file), "utf8"))
      .join("\n");

    for (const action of PUBLIC_ACTIONS) {
      const start = implementationSource.indexOf(
        `export async function ${action}`,
      );
      expect(
        start,
        `${action} implementation is missing`,
      ).toBeGreaterThanOrEqual(0);
      const next = implementationSource.indexOf(
        "export async function ",
        start + 30,
      );
      const implementation = implementationSource.slice(
        start,
        next < 0 ? undefined : next,
      );
      expect(
        implementation,
        `${action} is missing its server boundary`,
      ).toMatch(/\{\s*"use server";/u);
    }
  });
});
