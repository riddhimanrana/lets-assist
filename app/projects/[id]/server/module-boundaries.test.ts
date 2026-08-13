import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const serverDirectory = import.meta.dir;
const barrelPath = join(serverDirectory, "../actions.ts");
const barrelSource = readFileSync(barrelPath, "utf8");
const internalHelperFiles = ["access-helpers.ts", "waiver-persistence.ts"];
const implementationFiles = readdirSync(serverDirectory)
  .filter(
    (file) =>
      (file.endsWith(".ts") || file.endsWith(".tsx")) &&
      !file.includes(".test."),
  )
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

function hasModifier(node: ts.Node, kind: ts.SyntaxKind) {
  return ts.canHaveModifiers(node)
    ? (ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ??
        false)
    : false;
}

function hasTopLevelUseServer(sourceFile: ts.SourceFile) {
  for (const statement of sourceFile.statements) {
    if (
      !ts.isExpressionStatement(statement) ||
      !ts.isStringLiteral(statement.expression)
    ) {
      return false;
    }

    if (statement.expression.text === "use server") {
      return true;
    }
  }

  return false;
}

function exportedAsyncFunctions(file: string, source: string) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  if (!hasTopLevelUseServer(sourceFile)) return [];

  const localAsyncFunctions = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name &&
      hasModifier(statement, ts.SyntaxKind.AsyncKeyword)
    ) {
      localAsyncFunctions.add(statement.name.text);
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.initializer &&
          (ts.isArrowFunction(declaration.initializer) ||
            ts.isFunctionExpression(declaration.initializer)) &&
          hasModifier(declaration.initializer, ts.SyntaxKind.AsyncKeyword)
        ) {
          localAsyncFunctions.add(declaration.name.text);
        }
      }
    }
  }

  return sourceFile.statements.flatMap((statement) => {
    if (
      ts.isFunctionDeclaration(statement) &&
      hasModifier(statement, ts.SyntaxKind.ExportKeyword) &&
      hasModifier(statement, ts.SyntaxKind.AsyncKeyword)
    ) {
      return [{ file, name: statement.name?.text ?? "default" }];
    }

    if (
      ts.isVariableStatement(statement) &&
      hasModifier(statement, ts.SyntaxKind.ExportKeyword)
    ) {
      return statement.declarationList.declarations.flatMap((declaration) =>
        ts.isIdentifier(declaration.name) &&
        localAsyncFunctions.has(declaration.name.text)
          ? [{ file, name: declaration.name.text }]
          : [],
      );
    }

    if (
      ts.isExportDeclaration(statement) &&
      !statement.isTypeOnly &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      return statement.exportClause.elements.flatMap((element) => {
        if (element.isTypeOnly) return [];
        const localName = element.propertyName?.text ?? element.name.text;
        return statement.moduleSpecifier || localAsyncFunctions.has(localName)
          ? [{ file, name: element.name.text }]
          : [];
      });
    }

    if (
      ts.isExportAssignment(statement) &&
      !statement.isExportEquals &&
      ((ts.isIdentifier(statement.expression) &&
        localAsyncFunctions.has(statement.expression.text)) ||
        ((ts.isArrowFunction(statement.expression) ||
          ts.isFunctionExpression(statement.expression)) &&
          hasModifier(statement.expression, ts.SyntaxKind.AsyncKeyword)))
    ) {
      return [{ file, name: "default" }];
    }

    if (
      ts.isExportDeclaration(statement) &&
      !statement.isTypeOnly &&
      !statement.exportClause
    ) {
      return [{ file, name: "*" }];
    }

    if (
      ts.isExportDeclaration(statement) &&
      !statement.isTypeOnly &&
      statement.exportClause &&
      ts.isNamespaceExport(statement.exportClause)
    ) {
      return [{ file, name: statement.exportClause.name.text }];
    }

    return [];
  });
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

  test("exposes only reviewed public actions from file-level server modules", () => {
    const unexpectedActions = implementationFiles
      .flatMap((file) => {
        const source = readFileSync(join(serverDirectory, file), "utf8");
        return exportedAsyncFunctions(file, source);
      })
      .filter(
        ({ name }) => !(PUBLIC_ACTIONS as readonly string[]).includes(name),
      );

    expect(unexpectedActions).toEqual([]);
  });

  test("keeps internal project helpers server-only and outside the Server Action surface", () => {
    for (const file of internalHelperFiles) {
      const path = join(serverDirectory, file);
      expect(existsSync(path), file).toBe(true);
      if (!existsSync(path)) continue;

      const source = readFileSync(path, "utf8");
      expect(source, file).toMatch(/^import "server-only";/u);
      expect(source, file).not.toMatch(/["']use server["']/u);
      expect(exportedAsyncFunctions(file, source)).toEqual([]);
    }
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
