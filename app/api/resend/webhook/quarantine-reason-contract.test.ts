import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

mock.module("server-only", () => ({}));

/**
 * THE ONE TEST A ROUTE MOCK CANNOT REPLACE.
 *
 * The webhook route derives a quarantine reason code and hands it to
 * `csf_quarantine_communication_webhook()`. Every route test mocks that RPC, and a
 * mock accepts any string -- so the entire suite passed while the route emitted
 * `cross_tenant_evidence`, `contradictory_routing_evidence`, and
 * `unknown_tenant_coordinate` against a table CHECK that admitted none of them and
 * still listed an older vocabulary (`cross_tenant_provider_message`,
 * `contradictory_routing_tags`, `permanent_application_conflict`,
 * `unroutable_attempt`) that nothing produced.
 *
 * That drift was not cosmetic. A real permanent conflict would have reached
 * `quarantineAndAcknowledge()`, violated the CHECK, been reported as a quarantine
 * outage, and returned 503 -- and Resend retries every non-2xx forever. The one
 * fault class the quarantine exists to make durable would have been the one class
 * it could never record.
 *
 * This test reads the migration as text and holds three lists identical:
 *
 *   1. `CSF_ROUTE_QUARANTINE_REASON_CODES` in the route
 *   2. `v_caller_reasons` inside the quarantine RPC
 *   3. `csf_comm_webhook_quarantine_reason_check` on the table
 *
 * It needs no database: the CHECK is a literal in the migration, and the migration
 * is the contract. It is deliberately static so it runs in CI without a stack.
 */

const MIGRATION = resolve(
  import.meta.dir,
  "../../../../supabase/migrations/20260730001003_dvhs_csf_durable_communications.sql",
);
const ROUTE_SOURCE = resolve(import.meta.dir, "./implementation.ts");

/**
 * Every single-quoted literal in `sql`, ignoring `--` comments.
 *
 * Comment-stripping is not optional here. Both the CHECK and the RPC declaration
 * carry prose that NAMES the retired vocabulary in quotes, precisely so a future
 * reader knows what was removed and why. A naive scan would read those as members
 * and the test would assert the drift it exists to catch.
 */
function sqlLiterals(sql: string): string[] {
  const out: string[] = [];
  let i = 0;

  while (i < sql.length) {
    if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end + 1;
      continue;
    }
    if (sql[i] === "'") {
      let j = i + 1;
      let value = "";
      while (j < sql.length) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            value += "'";
            j += 2;
            continue;
          }
          break;
        }
        value += sql[j];
        j += 1;
      }
      out.push(value);
      i = j + 1;
      continue;
    }
    i += 1;
  }

  return out;
}

/** The text between `start` and the first `end` at or after it. */
function region(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  expect(from, `anchor not found: ${start}`).toBeGreaterThan(-1);
  const to = source.indexOf(end, from + start.length);
  expect(to, `terminator not found after ${start}: ${end}`).toBeGreaterThan(-1);
  return source.slice(from, to);
}

const migrationSql = readFileSync(MIGRATION, "utf8");
const routeSource = readFileSync(ROUTE_SOURCE, "utf8");

const checkCodes = sqlLiterals(
  region(
    migrationSql,
    "CONSTRAINT csf_comm_webhook_quarantine_reason_check",
    "CONSTRAINT csf_comm_webhook_quarantine_detail_check",
  ),
).sort();

const rpcCallerCodes = sqlLiterals(
  region(migrationSql, "v_caller_reasons constant text[] := ARRAY[", "];"),
).sort();

describe("quarantine reason vocabulary is identical across the route and the SQL", () => {
  const route =
    require("./implementation") as typeof import("./implementation");

  // Widened to string[] on purpose: these are compared against text parsed out of
  // the migration, which TypeScript cannot know anything about. Keeping the
  // literal union here would only prove the constant matches itself.
  const routeCodes: string[] = [
    ...route.CSF_ROUTE_QUARANTINE_REASON_CODES,
  ].sort();
  const rpcAuthoredCodes: string[] = [
    ...route.CSF_RPC_AUTHORED_QUARANTINE_REASON_CODES,
  ].sort();

  test("the anchors actually matched something", () => {
    // Guards the whole file against silently degrading into a tautology if the
    // migration is reorganised and a region comes back empty.
    expect(routeCodes.length).toBeGreaterThan(0);
    expect(rpcCallerCodes.length).toBeGreaterThan(0);
    expect(checkCodes.length).toBeGreaterThan(routeCodes.length - 1);
  });

  test("the RPC accepts exactly the codes the route can emit", () => {
    expect(rpcCallerCodes).toEqual(routeCodes);
  });

  test("the table CHECK admits every code the route can emit", () => {
    for (const code of routeCodes) {
      expect(checkCodes, `CHECK does not admit ${code}`).toContain(code);
    }
  });

  test("the table CHECK admits nothing beyond the route's set plus the RPC-authored code", () => {
    // The reverse direction. Without it, a retired name can sit in the CHECK
    // forever looking like a supported triage bucket that nothing can ever write.
    expect(checkCodes).toEqual([...routeCodes, ...rpcAuthoredCodes].sort());
  });

  test("the RPC-authored code is reserved: in the CHECK, refused as an argument", () => {
    for (const code of rpcAuthoredCodes) {
      expect(checkCodes).toContain(code);
      expect(rpcCallerCodes).not.toContain(code);
      expect(route.isQuarantineReasonCode(code)).toBe(false);
    }
  });

  // `unclassified_ledger_failure` is a LOG value for a fault no marker matched.
  // Such a fault is retryable, so it never reaches the quarantine path -- and
  // admitting it to the durable vocabulary would have meant inventing a triage
  // bucket whose entire content is "we do not know".
  test("unclassified_ledger_failure is not durable vocabulary anywhere", () => {
    expect(routeCodes).not.toContain("unclassified_ledger_failure");
    expect(rpcCallerCodes).not.toContain("unclassified_ledger_failure");
    expect(checkCodes).not.toContain("unclassified_ledger_failure");
    expect(route.isQuarantineReasonCode("unclassified_ledger_failure")).toBe(
      false,
    );
  });

  // The declared constant is only worth something if the CALL SITES use it. This
  // reads the route's own source for every literal handed to the quarantine
  // helper, so adding a new call with a new string fails here rather than at
  // runtime against a CHECK.
  test("every literal quarantine call site uses a code in the closed set", () => {
    const literals = [
      ...routeSource.matchAll(/quarantineAndAcknowledge\(\s*"([a-z_]+)"/g),
    ].map((match) => match[1]);

    expect(literals.length).toBeGreaterThan(0);
    for (const code of literals) {
      expect(routeCodes, `call site emits unmodelled ${code}`).toContain(code);
    }
  });

  // The non-literal call site passes a code derived from a ledger error. Proving
  // the derivation lands in the closed set is what closes the loop.
  //
  // Each marker is paired with the SQLSTATE the ledger actually raises for it.
  // This test previously handed `23514` to all four, which passed only because
  // classification ignored the code entirely -- the very defect that let a
  // transport error carrying a ledger sentence be filed as permanent.
  test("every derived permanent code is in the closed set", () => {
    const permanentFaults = [
      {
        sqlstate: "23505",
        marker: "was already recorded with different immutable evidence",
      },
      { sqlstate: "23514", marker: "refusing to bind contradictory evidence" },
      { sqlstate: "23503", marker: "belongs to another organization" },
      { sqlstate: "23503", marker: "does not exist in this organization" },
    ];

    for (const fault of permanentFaults) {
      const error = { message: fault.marker, code: fault.sqlstate };
      expect(route.ledgerFailureClass(error)).toBe("permanent");
      expect(routeCodes).toContain(route.ledgerReasonCode(error));
    }
  });

  // THE MIGRATION IS THE SOURCE OF TRUTH FOR THE SQLSTATES TOO.
  //
  // Pairing the route against a hand-typed list here would only prove the route
  // agrees with this file. Each marker is looked up in the migration and the
  // ERRCODE the ledger actually raises alongside it is read out of the SQL, so a
  // change to either side has to be made in both.
  //
  // WHY THE PREVIOUS VERSION OF THIS TEST WAS NOT AN ORACLE.
  //
  // It collected every SQLSTATE found within 400 characters after each marker and
  // asserted the set CONTAINED the expected one. Two things were wrong with that,
  // and they compound:
  //
  //   * `toContain` on a set of observations means one correct mapping hides every
  //     incorrect one. "does not exist in this organization" appears 25 times in
  //     this migration. If 24 raised 23503 and one raised 23514, the route's
  //     classification of that 25th fault would be wrong -- a permanent conflict
  //     filed as retryable, or the reverse -- and this test would still pass.
  //   * a fixed 400-character window is not a statement boundary. It can run past
  //     the end of the RAISE it belongs to and pick up the NEXT statement's
  //     ERRCODE, and it can stop short of a long diagnostic's own ERRCODE and find
  //     none at all -- at which point the old code simply skipped that occurrence.
  //
  // So each occurrence is now bound to exactly one RAISE, the number of bound
  // occurrences is required to equal the raw number of occurrences (nothing may be
  // silently skipped), and only then is the observed SQLSTATE set required to
  // equal exactly the one the route claims.
  test("each authored SQLSTATE matches the ERRCODE the migration raises", () => {
    const markers = [
      {
        marker: "was already recorded with different immutable evidence",
        sqlstate: "23505",
      },
      { marker: "refusing to bind contradictory evidence", sqlstate: "23514" },
      { marker: "belongs to another organization", sqlstate: "23503" },
      { marker: "does not exist in this organization", sqlstate: "23503" },
    ];

    const statements = raiseStatements(migrationSql);
    // Anti-tautology: if the scanner returned nothing, every loop below would be
    // vacuous and the mapped-count check would be the only thing failing.
    expect(statements.length).toBeGreaterThan(100);

    for (const { marker, sqlstate } of markers) {
      const raw = countOccurrences(migrationSql, marker);
      expect(raw, `the migration no longer raises: ${marker}`).toBeGreaterThan(
        0,
      );

      const observed = new Set<string>();
      let mapped = 0;

      for (const statement of statements) {
        const here = countOccurrences(statement.text, marker);
        if (here === 0) continue;

        const codes = [
          ...statement.text.matchAll(/USING ERRCODE = '([0-9A-Z]{5})'/g),
        ].map((match) => match[1]);

        // Exactly one. A RAISE with none would leave the route classifying by
        // message text alone; a RAISE with two is ambiguous about which applies.
        expect(
          codes.length,
          `the RAISE at line ${statement.line} carries "${marker}" with ` +
            `${codes.length} USING ERRCODE clauses, not exactly one`,
        ).toBe(1);

        mapped += here;
        observed.add(codes[0]);
      }

      // Nothing may be silently skipped. An occurrence outside a RAISE -- in a
      // comment, or in a diagnostic assembled some other way -- is a real gap: the
      // route classifies on `message.includes(marker)`, so a second source of that
      // text is a second fault class this pairing does not cover.
      expect(
        mapped,
        `${raw} occurrence(s) of "${marker}" in the migration but only ${mapped} ` +
          `bound to a RAISE ... USING ERRCODE; unbound at line(s) ` +
          `${unboundLines(migrationSql, marker, statements).join(", ")}`,
      ).toBe(raw);

      // EXACTLY the claimed code, for every occurrence. Not "among the codes seen".
      expect(
        [...observed].sort(),
        `route claims ${sqlstate} for "${marker}" but the migration raises ` +
          `${[...observed].sort().join(", ")} across its ${raw} occurrence(s)`,
      ).toEqual([sqlstate]);
    }
  });
});

interface RaiseStatement {
  /** Byte offset in the migration. Carried, not re-found: several RAISE bodies in
   * this file are byte-identical, so `indexOf(text)` would attribute all of them to
   * the first one's position and the unbound-line report would name the wrong
   * lines. */
  start: number;
  end: number;
  line: number;
  text: string;
}

/**
 * Every `RAISE ... ;` in the migration, as whole statements.
 *
 * The scanner has to be literal-aware in both directions. Diagnostics in this
 * migration contain semicolons -- "...stop the campaign on screen while leaving its
 * queued attempts claimable;" -- so a naive scan to the next `;` truncates the
 * statement before its `USING ERRCODE` and the occurrence looks unmapped. And
 * comments in this migration quote RAISE and ERRCODE while explaining past bugs, so
 * a naive scan for the keyword invents statements that were never compiled.
 *
 * Literals are therefore skipped whole when looking for the terminator, and both
 * comment forms are skipped when looking for the keyword.
 */
function raiseStatements(sql: string): RaiseStatement[] {
  const out: RaiseStatement[] = [];
  const isWord = (char: string | undefined) =>
    char !== undefined && /[A-Za-z0-9_]/.test(char);

  let i = 0;
  let start = -1;

  while (i < sql.length) {
    if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end + 1;
      continue;
    }
    if (sql.startsWith("/*", i)) {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          break;
        }
        j += 1;
      }
      // The literal is stepped over as one unit, so a `;` inside a diagnostic can
      // never be mistaken for the end of the statement.
      i = j + 1;
      continue;
    }
    if (
      start === -1 &&
      sql.startsWith("RAISE", i) &&
      !isWord(sql[i - 1]) &&
      !isWord(sql[i + 5])
    ) {
      start = i;
      i += 5;
      continue;
    }
    if (sql[i] === ";" && start !== -1) {
      out.push({
        start,
        end: i + 1,
        line: sql.slice(0, start).split("\n").length,
        text: sql.slice(start, i + 1),
      });
      start = -1;
    }
    i += 1;
  }

  return out;
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let cursor = haystack.indexOf(needle);
  while (cursor !== -1) {
    count += 1;
    cursor = haystack.indexOf(needle, cursor + needle.length);
  }
  return count;
}

/** Line numbers of marker occurrences that no parsed RAISE statement covers. */
function unboundLines(
  sql: string,
  marker: string,
  statements: RaiseStatement[],
): number[] {
  const lines: number[] = [];
  let cursor = sql.indexOf(marker);
  while (cursor !== -1) {
    const covered = statements.some(
      ({ start, end }) => start <= cursor && cursor < end,
    );
    if (!covered) lines.push(sql.slice(0, cursor).split("\n").length);
    cursor = sql.indexOf(marker, cursor + marker.length);
  }
  return lines;
}
