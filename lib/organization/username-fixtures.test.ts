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
  "tests/e2e/csf/account-deletion.spec.ts",
  "tests/e2e/csf/chapter-staff-invitation.spec.ts",
  "tests/e2e/csf/home-organization-links.spec.ts",
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

type SeriesBinding = ReadonlyMap<string, string>;

function boundedSeriesBindings(fromClause: string): SeriesBinding[] | null {
  const match = fromClause
    .trim()
    .match(
      /^from\s+(?:pg_catalog\.)?generate_series\(\s*(-?\d+)\s*,\s*(-?\d+)\s*(?:,\s*(-?\d+)\s*)?\)\s+(?:as\s+)?([a-z_][a-z0-9_]*)$/iu,
    );
  if (!match) return null;
  const [start, end, step] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3] ?? 1),
  ];
  if (
    ![start, end, step].every(
      (value) =>
        Number.isInteger(value) && value >= -2147483648 && value <= 2147483647,
    ) ||
    step === 0
  )
    return null;
  const count = Math.floor((end - start) / step) + 1;
  if (count < 1 || count > 1000) return null;
  return Array.from(
    { length: count },
    (_, index) =>
      new Map([[match[4].toLowerCase(), String(start + index * step)]]),
  );
}

function resolveSqlUsernameExpression(
  expression: string,
  binding: SeriesBinding = new Map(),
): string | null {
  const trimmed = expression.trim();
  const literal = sqlStringValue(trimmed);
  if (literal !== null) return literal;

  const concatenated = splitTopLevel(trimmed, "||");
  if (concatenated.length > 1) {
    const values = concatenated.map((part) =>
      resolveSqlUsernameExpression(part, binding),
    );
    return values.every((value): value is string => value !== null)
      ? values.join("")
      : null;
  }

  const variable = trimmed.match(/^([a-z_][a-z0-9_]*)(?:\s*::\s*text)?$/iu);
  if (variable) return binding.get(variable[1].toLowerCase()) ?? null;

  // Either end of the flattened uuid. `left` takes the version and variant
  // nibbles, which are fixed for a generated id; `right` takes the node bits,
  // which is where a fixture that mints one identifier per run puts the part
  // that actually varies. Both resolve to N hex characters for schema checking.
  const uuidSlice = trimmed.match(
    /^(left|right)\(\s*replace\(\s*organization_id::text\s*,\s*'-'\s*,\s*''\s*\)\s*,\s*(\d+)\s*\)$/iu,
  );
  if (uuidSlice) return "a".repeat(Number(uuidSlice[2]));

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
      const statementTail = source.slice(operationStart + fromOffset);
      const statementEnd = statementTail.indexOf(";");
      const fromClause =
        statementEnd === -1
          ? statementTail
          : statementTail.slice(0, statementEnd);
      const bindings = boundedSeriesBindings(fromClause) ?? [new Map()];
      const values = bindings.map((binding) =>
        expression ? resolveSqlUsernameExpression(expression, binding) : null,
      );
      expect(
        values.every((value) => value !== null),
        `${file}:${lineNumber(source, match.index)} unresolved username expression: ${expression}`,
      ).toBe(true);
      for (const value of values) {
        if (value === null || !expression) continue;
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

  const deletionFile = "tests/e2e/csf/account-deletion.spec.ts";
  const deletionSource = readFileSync(deletionFile, "utf8");
  const deletionExpression = "username: `del-${organizationId.slice(0, 12)}`";
  expect(deletionSource).toContain("const organizationId = randomUUID();");
  expect(deletionSource).toContain(deletionExpression);
  expect(deletionSource).toContain(
    "const local = getCsfIsolatedSupabaseEnv();",
  );
  expect(deletionSource).toContain(
    "createClient(local.url, local.serviceRoleKey",
  );
  expect(deletionSource).toContain(
    "const email = `deletion.${randomUUID()}@local.test`;",
  );
  expect(deletionSource).toContain("password: localTestPassword()");
  expect(deletionSource).toContain("await loginWithEmail(page, account.email");
  expect(deletionSource).toContain(
    '.from("organizations").delete().eq("id", organizationId)',
  );
  fixtures.push({
    expression: deletionExpression,
    file: deletionFile,
    line: lineNumber(
      deletionSource,
      deletionSource.indexOf(deletionExpression),
    ),
    value: "del-abcdef09-abc",
  });

  const invitationFile = "tests/e2e/csf/chapter-staff-invitation.spec.ts";
  const invitationSource = readFileSync(invitationFile, "utf8");
  expect(invitationSource).toContain("const organizationId = randomUUID();");
  expect(invitationSource).toContain(
    "join_code: fixtureJoinCode(organizationId)",
  );
  expect(invitationSource).toContain(
    "const username = `invitation-fixture-${organizationId.slice(0, 8)}`;",
  );
  fixtures.push({
    expression: "`invitation-fixture-${organizationId.slice(0, 8)}`",
    file: invitationFile,
    line: lineNumber(
      invitationSource,
      invitationSource.indexOf("const username ="),
    ),
    value: "invitation-fixture-abcdef09",
  });

  const homeFile = "tests/e2e/csf/home-organization-links.spec.ts";
  const homeSource = readFileSync(homeFile, "utf8");
  expect(homeSource).toContain("const id = randomUUID();");
  expect(homeSource).toContain("join_code: fixtureJoinCode(id)");
  const homeExpression = "username: `home-${id.slice(0, 8)}`";
  expect(homeSource).toContain(homeExpression);
  fixtures.push({
    expression: homeExpression,
    file: homeFile,
    line: lineNumber(homeSource, homeSource.indexOf(homeExpression)),
    value: "home-abcdef09",
  });

  return fixtures;
}

describe("bounded SQL username expressions", () => {
  const insert = (expression: string, source: string) =>
    `INSERT INTO public.organizations (username) SELECT ${expression} FROM ${source};`;

  test("enumerates every username in the chapter concurrency fixture", () => {
    const fixtures = sqlOrganizationUsernameFixtures(
      "bounded.sql",
      insert("'race-multi-chapter-' || i", "generate_series(1, 15) AS i"),
    );
    expect(fixtures.map(({ value }) => value)).toEqual(
      Array.from(
        { length: 15 },
        (_, index) => `race-multi-chapter-${index + 1}`,
      ),
    );
  });

  test("checks the longer usernames after a numeric width boundary", () => {
    const fixtures = sqlOrganizationUsernameFixtures(
      "bounded.sql",
      insert(`'${"a".repeat(31)}' || i::text`, "generate_series(9, 10) AS i"),
    );
    expect(
      fixtures.map(
        ({ value }) => organizationUsernameSchema.safeParse(value).success,
      ),
    ).toEqual([true, false]);
  });

  test("supports literal integer steps and SQL identifier case folding", () => {
    expect(
      sqlOrganizationUsernameFixtures(
        "bounded.sql",
        insert(
          "'chapter-' || n::text",
          "pg_catalog.generate_series(15, 9, -2) AS N",
        ),
      ).map(({ value }) => value),
    ).toEqual(["chapter-15", "chapter-13", "chapter-11", "chapter-9"]);
  });

  test.each([
    "generate_series(1, limit_count) AS i",
    "generate_series(1, 1001) AS i",
    "generate_series(1, 3, 0) AS i",
    "generate_series(3, 1) AS i",
    "generate_series(1, 3, -1) AS i",
    "generate_series(2147483648, 2147483649) AS i",
    "generate_series(1, 1.5) AS i",
    "generate_series(1, 3)",
    "generate_series(1, 3) AS other_alias",
    "generate_series(1, 3) AS i JOIN fixture_values v ON true",
    "fixture_values AS i",
  ])("does not guess a username for unsupported source %s", (source) => {
    expect(() =>
      sqlOrganizationUsernameFixtures(
        "unknown.sql",
        insert("'chapter-' || i", source),
      ),
    ).toThrow("unresolved username expression");
  });

  test("does not evaluate unknown operations on a bounded alias", () => {
    expect(() =>
      sqlOrganizationUsernameFixtures(
        "unknown.sql",
        insert(
          "'chapter-' || unknown_function(i)",
          "generate_series(1, 3) AS i",
        ),
      ),
    ).toThrow("unresolved username expression");
    expect(resolveSqlUsernameExpression("'chapter-' || i")).toBeNull();
  });

  test("does not reuse a series binding in another insert", () => {
    expect(() =>
      sqlOrganizationUsernameFixtures(
        "scope.sql",
        `${insert("'chapter-' || i", "generate_series(1, 3) AS i")}\n${insert("'other-' || i", "fixture_values")}`,
      ),
    ).toThrow("unresolved username expression");
  });

  test("keeps literal and UUID fixture expressions working", () => {
    expect(resolveSqlUsernameExpression("'chapter-' || 'abc'")).toBe(
      "chapter-abc",
    );
    expect(
      resolveSqlUsernameExpression(
        "'chapter-' || right(replace(organization_id::text, '-', ''), 8)",
      ),
    ).toBe("chapter-aaaaaaaa");
    expect(resolveSqlUsernameExpression("repeat('a', 32)")).toBe(
      "a".repeat(32),
    );
  });
});

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
    expect(fixtures).toHaveLength(11);

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
