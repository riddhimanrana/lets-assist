import { describe, expect, test } from "bun:test";
import fg from "fast-glob";
import { readFileSync } from "node:fs";

import { isReservedOrganizationSlug } from "./reserved-slugs";
import { organizationUsernameSchema } from "./username";

type UsernameFixture = {
  expression: string;
  file: string;
  line: number;
  value: string;
  exemptionReason?: string;
};

const SQL_FIXTURE_PATTERNS = [
  "supabase/tests/**/*.sql",
  "supabase/seed.sql",
  "supabase/seeds/**/*.sql",
  "supabase/snippets/**/*.sql",
  "scripts/**/*.sql",
  "scripts/**/*.sh",
];
// A fixture may hold a value the product schema rejects only when it exists to
// test that value, and only when it says so on the line directly above the
// write. Every marker is itemized by the accounting test below, so adding one is
// a deliberate edit to this file rather than a quiet opt-out.
const EXEMPTION_MARKER = "organization-username-fixture-exempt:";
const RESERVED_SLUG_DATABASE_TEST =
  "supabase/tests/database/organization_username_reserved_slugs.test.sql";
const JAVASCRIPT_ORGANIZATION_WRITERS = [
  "scripts/local-dev/seed-dvsd.mjs",
  "scripts/local-dev/seed-platform.mjs",
  "scripts/local-dev/test-dvhs-csf-scale.mjs",
];

function maskSqlComments(source: string): string {
  let masked = "";
  let index = 0;
  let inSingleQuote = false;

  while (index < source.length) {
    if (inSingleQuote) {
      if (source[index] === "'" && source[index + 1] === "'") {
        masked += "''";
        index += 2;
        continue;
      }
      if (source[index] === "'") inSingleQuote = false;
      masked += source[index];
      index += 1;
      continue;
    }

    if (source[index] === "'") {
      inSingleQuote = true;
      masked += source[index];
      index += 1;
      continue;
    }
    if (source.startsWith("--", index)) {
      while (index < source.length && source[index] !== "\n") {
        masked += " ";
        index += 1;
      }
      continue;
    }
    if (source.startsWith("/*", index)) {
      masked += "  ";
      index += 2;
      while (index < source.length && !source.startsWith("*/", index)) {
        masked += source[index] === "\n" ? "\n" : " ";
        index += 1;
      }
      if (index < source.length) {
        masked += "  ";
        index += 2;
      }
      continue;
    }
    masked += source[index];
    index += 1;
  }

  return masked;
}

function dollarQuoteAt(source: string, index: number): string | null {
  return (
    source.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/u)?.[0] ?? null
  );
}

function closingParenthesis(source: string, opening: number): number {
  let depth = 0;
  let index = opening;

  while (index < source.length) {
    const character = source[index];
    if (character === "'") {
      index += 1;
      while (index < source.length) {
        if (source[index] === "'" && source[index + 1] === "'") {
          index += 2;
        } else if (source[index] === "'") {
          index += 1;
          break;
        } else {
          index += 1;
        }
      }
      continue;
    }

    const delimiter = character === "$" ? dollarQuoteAt(source, index) : null;
    if (delimiter) {
      const closing = source.indexOf(delimiter, index + delimiter.length);
      if (closing === -1) return -1;
      index = closing + delimiter.length;
      continue;
    }

    if (character === "(") depth += 1;
    if (character === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
    index += 1;
  }

  return -1;
}

function splitTopLevel(source: string, delimiter = ","): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let index = 0;

  while (index < source.length) {
    if (source[index] === "'") {
      index += 1;
      while (index < source.length) {
        if (source[index] === "'" && source[index + 1] === "'") {
          index += 2;
        } else if (source[index] === "'") {
          index += 1;
          break;
        } else {
          index += 1;
        }
      }
      continue;
    }
    if (source[index] === "(") depth += 1;
    if (source[index] === ")") depth -= 1;
    if (depth === 0 && source.startsWith(delimiter, index)) {
      parts.push(source.slice(start, index).trim());
      index += delimiter.length;
      start = index;
      continue;
    }
    index += 1;
  }

  parts.push(source.slice(start).trim());
  return parts;
}

function exemptionReasonsByLine(rawSource: string): Map<number, string> {
  // Keyed by the line the write starts on, which is the line after the marker.
  // Scoping it that tightly means an exemption cannot drift onto a statement it
  // was not written for.
  const reasons = new Map<number, string>();
  rawSource.split("\n").forEach((line, index) => {
    const marker = line.indexOf(EXEMPTION_MARKER);
    if (marker === -1) return;
    const reason = line.slice(marker + EXEMPTION_MARKER.length).trim();
    if (reason.length > 0) reasons.set(index + 2, reason);
  });
  return reasons;
}

function throwsOkRanges(source: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const pattern = /\bextensions\.throws_ok\s*\(/giu;
  for (const match of source.matchAll(pattern)) {
    const opening = match.index + match[0].lastIndexOf("(");
    const closing = closingParenthesis(source, opening);
    if (closing !== -1) ranges.push([match.index, closing]);
  }
  return ranges;
}

function sqlStringValue(expression: string): string | null {
  const match = expression
    .trim()
    .match(/^(?:E)?'((?:''|[^'])*)'(?:\s*::\s*[A-Za-z0-9_.]+)?$/iu);
  return match ? match[1].replaceAll("''", "'") : null;
}

function resolveSqlUsernameExpression(expression: string): string | null {
  const trimmed = expression.trim();
  const literal = sqlStringValue(trimmed);
  if (literal !== null) return literal;

  const concatenated = splitTopLevel(trimmed, "||");
  if (concatenated.length > 1) {
    const values = concatenated.map(resolveSqlUsernameExpression);
    return values.every((value): value is string => value !== null)
      ? values.join("")
      : null;
  }

  const uuidSuffix = trimmed.match(
    /^left\(\s*replace\(\s*organization_id::text\s*,\s*'-'\s*,\s*''\s*\)\s*,\s*(\d+)\s*\)$/iu,
  );
  if (uuidSuffix) return "a".repeat(Number(uuidSuffix[1]));

  const repeated = trimmed.match(/^repeat\(\s*'([^']*)'\s*,\s*(\d+)\s*\)$/iu);
  if (repeated) return repeated[1].repeat(Number(repeated[2]));

  return null;
}

function lineNumber(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function sqlOrganizationUsernameFixtures(
  file: string,
  rawSource: string,
): UsernameFixture[] {
  const source = maskSqlComments(rawSource);
  const fixtures: UsernameFixture[] = [];
  const intentionalRejections =
    file === RESERVED_SLUG_DATABASE_TEST ? throwsOkRanges(source) : [];
  const insertPattern = /\binsert\s+into\s+(?:public\.)?organizations\b/giu;

  for (const match of source.matchAll(insertPattern)) {
    if (
      intentionalRejections.some(
        ([start, end]) => match.index >= start && match.index <= end,
      )
    ) {
      continue;
    }

    let columnsOpening = match.index + match[0].length;
    while (/\s/u.test(source[columnsOpening] ?? "")) columnsOpening += 1;
    expect(
      source[columnsOpening],
      `${file}:${lineNumber(source, match.index)} must list organization columns explicitly`,
    ).toBe("(");
    if (source[columnsOpening] !== "(") continue;
    const columnsClosing = closingParenthesis(source, columnsOpening);
    expect(
      columnsClosing,
      `${file}:${lineNumber(source, match.index)}`,
    ).not.toBe(-1);
    const columns = splitTopLevel(
      source.slice(columnsOpening + 1, columnsClosing),
    ).map((column) => column.replaceAll('"', "").trim().toLowerCase());
    const usernameIndex = columns.indexOf("username");
    expect(
      usernameIndex,
      `${file}:${lineNumber(source, match.index)}`,
    ).toBeGreaterThanOrEqual(0);

    const tail = source.slice(columnsClosing + 1);
    const operation = tail.match(/^\s*(values|select)\b/iu);
    expect(
      operation,
      `${file}:${lineNumber(source, match.index)}`,
    ).not.toBeNull();
    if (!operation) continue;

    const operationStart = columnsClosing + 1 + operation[0].length;
    if (operation[1].toLowerCase() === "select") {
      const fromOffset = source.slice(operationStart).search(/\bfrom\b/iu);
      expect(
        fromOffset,
        `${file}:${lineNumber(source, match.index)}`,
      ).toBeGreaterThanOrEqual(0);
      const expressions = splitTopLevel(
        source.slice(operationStart, operationStart + fromOffset),
      );
      const expression = expressions[usernameIndex];
      const value = expression
        ? resolveSqlUsernameExpression(expression)
        : null;
      expect(
        value,
        `${file}:${lineNumber(source, match.index)} unresolved username expression: ${expression}`,
      ).not.toBeNull();
      if (value !== null && expression) {
        fixtures.push({
          expression,
          file,
          line: lineNumber(source, match.index),
          value,
        });
      }
      continue;
    }

    let rowOpening = operationStart;
    while (rowOpening < source.length) {
      while (/\s|,/u.test(source[rowOpening] ?? "")) rowOpening += 1;
      if (source[rowOpening] !== "(") break;
      const rowClosing = closingParenthesis(source, rowOpening);
      expect(rowClosing, `${file}:${lineNumber(source, rowOpening)}`).not.toBe(
        -1,
      );
      if (rowClosing === -1) break;
      const expressions = splitTopLevel(
        source.slice(rowOpening + 1, rowClosing),
      );
      const expression = expressions[usernameIndex];
      const value = expression
        ? resolveSqlUsernameExpression(expression)
        : null;
      expect(
        value,
        `${file}:${lineNumber(source, rowOpening)} unresolved username expression: ${expression}`,
      ).not.toBeNull();
      if (value !== null && expression) {
        fixtures.push({
          expression,
          file,
          line: lineNumber(source, rowOpening),
          value,
        });
      }
      rowOpening = rowClosing + 1;
    }
  }

  const updatePattern =
    /\bupdate\s+(?:public\.)?organizations\s+set\s+username\s*=\s*((?:E)?'(?:''|[^'])*')/giu;
  for (const match of source.matchAll(updatePattern)) {
    if (
      intentionalRejections.some(
        ([start, end]) => match.index >= start && match.index <= end,
      )
    ) {
      continue;
    }
    const value = sqlStringValue(match[1]);
    if (value !== null) {
      fixtures.push({
        expression: match[1],
        file,
        line: lineNumber(source, match.index),
        value,
      });
    }
  }

  const exemptions = exemptionReasonsByLine(rawSource);
  return fixtures.map((fixture) => {
    const reason = exemptions.get(fixture.line);
    return reason ? { ...fixture, exemptionReason: reason } : fixture;
  });
}

function literalUsernames(source: string): string[] {
  return [...source.matchAll(/\busername\s*:\s*"([^"]+)"/gu)].map(
    (match) => match[1],
  );
}

function javascriptOrganizationUsernameFixtures(): UsernameFixture[] {
  const discoveredWriters = fg
    .sync("{scripts,tests,supabase}/**/*.{js,mjs,cjs,ts,tsx}")
    .filter((file) =>
      /\.from\(["']organizations["']\)[\s\S]{0,800}?\.(?:insert|upsert|update)\(/u.test(
        readFileSync(file, "utf8"),
      ),
    )
    .sort();
  expect(discoveredWriters).toEqual(JAVASCRIPT_ORGANIZATION_WRITERS);

  const fixtures: UsernameFixture[] = [];
  const platformFile = "scripts/local-dev/seed-platform.mjs";
  const platformSource = readFileSync(platformFile, "utf8");
  const platformOrganizationArray = platformSource.match(
    /const organizations = \[([\s\S]*?)\n {2}\];/u,
  )?.[1];
  expect(platformOrganizationArray).toBeDefined();
  for (const value of literalUsernames(platformOrganizationArray ?? "")) {
    fixtures.push({
      expression: JSON.stringify(value),
      file: platformFile,
      line: 1,
      value,
    });
  }

  const dvsdFile = "scripts/local-dev/seed-dvsd.mjs";
  const dvsdSource = readFileSync(dvsdFile, "utf8");
  const dvsdWrites = [
    ...dvsdSource.matchAll(
      /\.from\("organizations"\)\.upsert\(\{([\s\S]*?)\n {4}\}\)/gu,
    ),
  ];
  expect(dvsdWrites).toHaveLength(3);
  for (const write of dvsdWrites) {
    const values = literalUsernames(write[1]);
    expect(values).toHaveLength(1);
    fixtures.push({
      expression: JSON.stringify(values[0]),
      file: dvsdFile,
      line: lineNumber(dvsdSource, write.index),
      value: values[0],
    });
  }

  const scaleFile = "scripts/local-dev/test-dvhs-csf-scale.mjs";
  const scaleSource = readFileSync(scaleFile, "utf8");
  expect(scaleSource).toContain("const suffix = `${Date.now()}`.slice(-9);");
  expect(scaleSource).toContain("const username = `csf-scale-${suffix}`;");
  fixtures.push({
    expression: "`csf-scale-${suffix}` with a nine-character suffix",
    file: scaleFile,
    line: lineNumber(scaleSource, scaleSource.indexOf("const username =")),
    value: `csf-scale-${"9".repeat(9)}`,
  });

  return fixtures;
}

function fixtureError(fixture: UsernameFixture): string {
  return `${fixture.file}:${fixture.line} ${JSON.stringify(fixture.value)} from ${fixture.expression}`;
}

describe("organization username fixture inventory", () => {
  test("every post-migration SQL fixture write satisfies the shared product schema", () => {
    const files = fg.sync(SQL_FIXTURE_PATTERNS, { onlyFiles: true }).sort();
    const fixtures = files.flatMap((file) =>
      sqlOrganizationUsernameFixtures(file, readFileSync(file, "utf8")),
    );
    expect(fixtures.length).toBeGreaterThan(0);

    const invalid = fixtures.filter(
      ({ value, exemptionReason }) =>
        exemptionReason === undefined &&
        (!organizationUsernameSchema.safeParse(value).success ||
          isReservedOrganizationSlug(value)),
    );
    expect(invalid.map(fixtureError)).toEqual([]);
  });

  test("every schema-invalid fixture is exempted deliberately and for a stated reason", () => {
    const files = fg.sync(SQL_FIXTURE_PATTERNS, { onlyFiles: true }).sort();
    const exempted = files
      .flatMap((file) =>
        sqlOrganizationUsernameFixtures(file, readFileSync(file, "utf8")),
      )
      .filter(({ exemptionReason }) => exemptionReason !== undefined)
      .map(({ file, value, exemptionReason }) => ({
        file,
        value,
        exemptionReason,
      }));

    // Itemized on purpose. A new exemption fails here until someone adds it,
    // which is the point: the marker cannot be used to quietly widen what the
    // product schema accepts.
    expect(exempted).toEqual([
      {
        file: "supabase/tests/database/plugin_application_runtime_admin_controls.test.sql",
        value: "ApplicationRuntimeAdmin",
        exemptionReason:
          "historical mixed-case username predating the lowercase-only rule; the assertion below proves such a row still routes",
      },
    ]);

    // An exemption is only meaningful if the value really would have failed.
    for (const { value } of exempted) {
      expect(
        organizationUsernameSchema.safeParse(value).success &&
          !isReservedOrganizationSlug(value),
      ).toBe(false);
    }
  });

  test("every JavaScript seed and scale write satisfies the shared product schema", () => {
    const fixtures = javascriptOrganizationUsernameFixtures();
    expect(fixtures).toHaveLength(8);

    const invalid = fixtures.filter(
      ({ value }) =>
        !organizationUsernameSchema.safeParse(value).success ||
        isReservedOrganizationSlug(value),
    );
    expect(invalid.map(fixtureError)).toEqual([]);
  });

  test("the reserved-slug pgTAP fixture does not reuse another database fixture UUID", () => {
    const fixtureSource = readFileSync(RESERVED_SLUG_DATABASE_TEST, "utf8");
    const fixtureIds = [
      ...fixtureSource.matchAll(
        /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu,
      ),
    ].map((match) => match[0].toLowerCase());

    expect(fixtureIds.length).toBeGreaterThan(0);
    const fixtureIdSet = new Set(fixtureIds);
    const collisions = fg
      .sync("supabase/tests/database/*.sql", { onlyFiles: true })
      .filter((file) => file !== RESERVED_SLUG_DATABASE_TEST)
      .flatMap((file) =>
        [
          ...readFileSync(file, "utf8").matchAll(
            /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu,
          ),
        ]
          .map((match) => match[0].toLowerCase())
          .filter((id) => fixtureIdSet.has(id))
          .map((id) => `${file}: ${id}`),
      );

    expect(collisions).toEqual([]);
  });

  test("the pgTAP ACL checks distinguish column-scoped writes from table deletion", () => {
    const fixtureSource = readFileSync(RESERVED_SLUG_DATABASE_TEST, "utf8");
    const aclContract = fixtureSource.slice(
      fixtureSource.indexOf("-- The final client relation ACL catalog"),
      fixtureSource.indexOf("-- Prove it end-to-end, not just via the catalog"),
    );

    expect(aclContract).toContain("has_column_privilege(");
    expect(aclContract).toContain(
      "has_table_privilege('authenticated', 'public.organizations', 'DELETE')",
    );
    expect(aclContract).not.toContain(
      "has_table_privilege('authenticated', 'public.organizations', privilege_name)",
    );
  });
});
