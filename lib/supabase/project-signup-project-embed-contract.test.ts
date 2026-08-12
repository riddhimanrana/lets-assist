import { expect, test } from "bun:test";
import fg from "fast-glob";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../..");
const CANONICAL_PROJECT_RELATIONSHIP = "project_signups_project_id_fkey";
const SOURCE_GLOBS = [
  "app/**/*.{ts,tsx,js,mjs,cjs}",
  "components/**/*.{ts,tsx,js,mjs,cjs}",
  "emails/**/*.{ts,tsx,js,mjs,cjs}",
  "hooks/**/*.{ts,tsx,js,mjs,cjs}",
  "lib/**/*.{ts,tsx,js,mjs,cjs}",
  "schemas/**/*.{ts,tsx,js,mjs,cjs}",
  "scripts/**/*.{ts,tsx,js,mjs,cjs}",
  "services/**/*.{ts,tsx,js,mjs,cjs}",
  "utils/**/*.{ts,tsx,js,mjs,cjs}",
];
const SOURCE_IGNORES = [
  "**/*.test.*",
  "**/*.spec.*",
  "**/node_modules/**",
  "**/.next/**",
  "**/.artifacts/**",
  "lib/plugins/private/**",
];

type ProjectEmbed = {
  file: string;
  outputAlias: string;
  relationshipHint: string | null;
  inner: boolean;
  selection: string;
};

function unwrapExpression(expression: ts.Expression): ts.Expression {
  if (
    ts.isAsExpression(expression) ||
    ts.isParenthesizedExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    return unwrapExpression(expression.expression);
  }
  return expression;
}

function staticStringValues(
  expression: ts.Expression,
  initializers: ReadonlyMap<string, ts.Expression>,
  resolving = new Set<string>(),
): string[] | null {
  const unwrapped = unwrapExpression(expression);

  if (ts.isStringLiteralLike(unwrapped)) {
    return [unwrapped.text];
  }

  if (ts.isTemplateExpression(unwrapped)) {
    let values = [unwrapped.head.text];
    for (const span of unwrapped.templateSpans) {
      const interpolations = staticStringValues(
        span.expression,
        initializers,
        resolving,
      );
      if (!interpolations) return null;
      values = values.flatMap((prefix) =>
        interpolations.map(
          (interpolation) => prefix + interpolation + span.literal.text,
        ),
      );
    }
    return values;
  }

  if (
    ts.isBinaryExpression(unwrapped) &&
    unwrapped.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = staticStringValues(unwrapped.left, initializers, resolving);
    const right = staticStringValues(unwrapped.right, initializers, resolving);
    if (!left || !right) return null;
    return left.flatMap((prefix) => right.map((suffix) => prefix + suffix));
  }

  if (ts.isConditionalExpression(unwrapped)) {
    const whenTrue = staticStringValues(
      unwrapped.whenTrue,
      initializers,
      resolving,
    );
    const whenFalse = staticStringValues(
      unwrapped.whenFalse,
      initializers,
      resolving,
    );
    return whenTrue && whenFalse ? [...whenTrue, ...whenFalse] : null;
  }

  if (ts.isIdentifier(unwrapped)) {
    if (resolving.has(unwrapped.text)) return null;
    const initializer = initializers.get(unwrapped.text);
    if (!initializer) return null;
    const nextResolving = new Set(resolving);
    nextResolving.add(unwrapped.text);
    return staticStringValues(initializer, initializers, nextResolving);
  }

  return null;
}

function projectSignupSelectArgument(
  call: ts.CallExpression,
): ts.Expression | null {
  if (!ts.isPropertyAccessExpression(call.expression)) return null;
  if (call.expression.name.text !== "select") return null;

  const receiver = unwrapExpression(call.expression.expression);
  if (!ts.isCallExpression(receiver)) return null;
  if (!ts.isPropertyAccessExpression(receiver.expression)) return null;
  if (receiver.expression.name.text !== "from") return null;

  const table = receiver.arguments[0];
  if (!table || !ts.isStringLiteralLike(unwrapExpression(table))) return null;
  if (
    (unwrapExpression(table) as ts.StringLiteralLike).text !== "project_signups"
  ) {
    return null;
  }

  return call.arguments[0] ?? null;
}

function parseProjectEmbeds(file: string, selection: string): ProjectEmbed[] {
  const compactSelection = selection.replace(/\s+/gu, "");
  const embedPattern =
    /(?:([A-Za-z_$][\w$]*):)?(projects|project_id)((?:![A-Za-z_$][\w$]*)*)\(/gu;

  return [...compactSelection.matchAll(embedPattern)].map((match) => {
    const alias = match[1];
    const relation = match[2];
    if (!relation) {
      throw new Error(`Could not parse project embed in ${file}`);
    }
    const modifiers = (match[3] ?? "").split("!").filter(Boolean);
    const relationshipHint =
      relation === "project_id"
        ? "project_id"
        : (modifiers.find(
            (modifier) => modifier !== "inner" && modifier !== "left",
          ) ?? null);

    return {
      file,
      outputAlias: alias ?? relation,
      relationshipHint,
      inner: modifiers.includes("inner"),
      selection,
    };
  });
}

function analyzeSource(
  file: string,
  source: string,
): {
  embeds: ProjectEmbed[];
  unresolvedSelects: string[];
} {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const initializers = new Map<string, ts.Expression>();
  const embeds: ProjectEmbed[] = [];
  const unresolvedSelects: string[] = [];

  function collectInitializers(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      initializers.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, collectInitializers);
  }
  collectInitializers(sourceFile);

  function inspect(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const argument = projectSignupSelectArgument(node);
      if (argument) {
        const selections = staticStringValues(argument, initializers);
        if (!selections) {
          const line =
            sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          unresolvedSelects.push(`${file}:${line}`);
        } else {
          for (const selection of selections) {
            embeds.push(...parseProjectEmbeds(file, selection));
          }
        }
      }
    }
    ts.forEachChild(node, inspect);
  }
  inspect(sourceFile);

  return { embeds, unresolvedSelects };
}

const sourceFiles = fg
  .sync(SOURCE_GLOBS, {
    cwd: REPOSITORY_ROOT,
    ignore: SOURCE_IGNORES,
    onlyFiles: true,
  })
  .sort();
const analysis = sourceFiles.map((file) =>
  analyzeSource(file, readFileSync(resolve(REPOSITORY_ROOT, file), "utf8")),
);
const projectEmbeds = analysis.flatMap((result) => result.embeds);

test("inventories every root project_signups to projects embed and its DTO shape", () => {
  expect(
    projectEmbeds
      .map(({ file, outputAlias, inner }) => ({ file, outputAlias, inner }))
      .sort((left, right) => left.file.localeCompare(right.file)),
  ).toEqual([
    {
      file: "app/account/calendar/page.tsx",
      outputAlias: "project",
      inner: false,
    },
    {
      file: "app/api/calendar/synced-events/route.ts",
      outputAlias: "projects",
      inner: false,
    },
    {
      file: "app/api/cron/auto-publish-hours/route.ts",
      outputAlias: "projects",
      inner: true,
    },
    {
      file: "app/dashboard/_components/dashboard-data.ts",
      outputAlias: "projects",
      inner: false,
    },
    {
      file: "app/projects/[id]/server/waiver-queries.ts",
      outputAlias: "project",
      inner: false,
    },
    {
      file: "app/projects/UserProjects.tsx",
      outputAlias: "projects",
      inner: false,
    },
  ]);
});

test("every root project_signups to projects embed names the canonical relationship", () => {
  expect(analysis.flatMap((result) => result.unresolvedSelects)).toEqual([]);

  const ambiguous = projectEmbeds
    .filter(
      ({ relationshipHint }) =>
        relationshipHint !== CANONICAL_PROJECT_RELATIONSHIP &&
        relationshipHint !== "project_id",
    )
    .map(({ file, selection }) => `${file}: ${selection.trim()}`);

  expect(ambiguous).toEqual([]);
});

test("the source analyzer resolves relationship embeds in composed select strings", () => {
  const result = analyzeSource(
    "dynamic-select.ts",
    `
      const projectFields = "projects (id, title)";
      const selection = \`id, \${projectFields}\`;
      client.from("project_signups").select(selection);
    `,
  );

  expect(result.unresolvedSelects).toEqual([]);
  expect(result.embeds).toEqual([
    {
      file: "dynamic-select.ts",
      outputAlias: "projects",
      relationshipHint: null,
      inner: false,
      selection: "id, projects (id, title)",
    },
  ]);
});
