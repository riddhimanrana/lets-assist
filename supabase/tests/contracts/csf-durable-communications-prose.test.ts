import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE PROSE IS PART OF THE CONTRACT, AND IT WENT STALE.
 *
 * 20260730001003 converges on one privilege boundary: every communications base
 * table is server-only, service_role holds exactly SELECT, and every legitimate
 * write arrives through the owned SECURITY DEFINER RPC surface. That convergence
 * happened in section J -- but six passages elsewhere in the file still described
 * the WORLD BEFORE IT, in the present tense:
 *
 *   * "service_role is the only role that may write these tables" (helper preamble)
 *   * "service_role holds INSERT on this table directly" (audience freeze)
 *   * "including a bare service-role statement" (attempt evidence freeze)
 *   * "A direct service_role UPDATE runs through it exactly as the RPC does"
 *     (campaign terminalization)
 *   * "a bare service-role `UPDATE ... SET status = 'cancelled'` sailed straight
 *     through it. That is a real hole" (cancellation converse, present tense)
 *   * "Runs for direct service_role UPDATEs too" (terminalization COMMENT)
 *
 * None of those is cosmetic. A reader auditing the write boundary reads the
 * comment next to the trigger, not the grant block 6000 lines later, and every one
 * of those passages told them the server role could write the table directly. The
 * next person to "simplify" a trigger on the strength of that reading removes the
 * only layer that still applies to the owner.
 *
 * This file is the guard that stops them coming back. It needs no database: the
 * grants, the comments, and the purge result contracts are all literals in the
 * migration, and the migration is the contract.
 *
 * IT IS NOT A STRING-MATCHING EXERCISE. Three of the four layers are executable:
 * the privilege layer parses the real GRANT/REVOKE statements, and the purge layer
 * parses the actual jsonb_build_object argument lists rather than trusting the
 * prose that describes them. And every forbidden pattern is proved LIVE against
 * the exact historical sentence it retired, so a detector that stops detecting
 * fails here rather than passing silently.
 */

const MIGRATION = resolve(
  import.meta.dir,
  "../../migrations/20260730001003_dvhs_csf_durable_communications.sql",
);

const migrationSql = readFileSync(MIGRATION, "utf8");

// ---------------------------------------------------------------------------
// The prose corpus: everything in the file that is commentary rather than
// executable SQL.
//
// Both line comments AND single-quoted literals are included, because the stale
// terminalization claim lived in a COMMENT ON FUNCTION body -- a single-quoted
// literal -- and a scan of `--` lines alone would have missed it entirely.
// Including string literals also means a RAISE diagnostic cannot assert a grant
// the schema does not give.
//
// Real GRANT/REVOKE statements are NOT in the corpus, which is what lets the
// forbidden patterns below be blunt about `service_role` without tripping over
// `GRANT SELECT ON TABLE ... TO service_role`.
// ---------------------------------------------------------------------------

/** Contiguous runs of `--` commentary, joined into one block per run. */
function commentBlocks(sql: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];

  for (const line of sql.split("\n")) {
    const marker = line.indexOf("--");
    if (marker === -1) {
      if (current.length > 0) {
        blocks.push(current.join(" "));
        current = [];
      }
      continue;
    }
    current.push(line.slice(marker + 2).trim());
  }
  if (current.length > 0) blocks.push(current.join(" "));
  return blocks;
}

/** Every single-quoted literal, with `''` unescaped. */
function sqlLiterals(sql: string): string[] {
  const out: string[] = [];
  let i = 0;

  while (i < sql.length) {
    if (sql[i] !== "'") {
      i += 1;
      continue;
    }
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
  }
  return out;
}

const proseCorpus = [...commentBlocks(migrationSql), ...sqlLiterals(migrationSql)];
const proseText = proseCorpus.join("\n");

// ---------------------------------------------------------------------------
// LAYER 1. Prose that claims a direct table write privilege for the server role.
//
// Every pattern is bounded by `[^.;:]` where it spans at all, so it can never
// match across a sentence boundary and read two unrelated clauses as one claim.
//
// PRESENT TENSE ONLY. The migration legitimately narrates the history it fixed --
// "Previously service_role held SELECT/INSERT/UPDATE/DELETE", "This block used to
// grant service_role INSERT and UPDATE", "While service_role still held UPDATE on
// this table" -- and that narration is the reason the triggers exist. So the
// patterns match `holds` and never `held`, and each carries the historical
// sentence it retired as a live self-check.
// ---------------------------------------------------------------------------

interface ForbiddenClaim {
  id: string;
  pattern: RegExp;
  why: string;
  /** The exact retired sentence. Proves the pattern still detects. */
  retired: string;
  /** Present-tense-truthful text that must NOT trip the pattern. */
  permitted: string[];
  /**
   * A NAMED, NARROW exemption applied to the clause around a hit.
   *
   * Deliberately not a general "does this clause contain a negation" rule: the
   * retired attempt-evidence sentence itself reads "...so the RPCs are not the
   * only thing standing between an operator and a rewritten audit trail", so a
   * generic `not` would have exempted the exact claim this file exists to catch.
   * Each exemption spells out the one construction it forgives.
   */
  exemptIf?: RegExp;
}

/** The clause a hit sits in: from the previous sentence terminator to the hit's end. */
function clauseAround(block: string, match: RegExpMatchArray): string {
  const end = (match.index ?? 0) + match[0].length;
  const head = block.slice(0, end);
  const boundary = Math.max(
    head.lastIndexOf("."),
    head.lastIndexOf(";"),
    head.lastIndexOf(":"),
  );
  return head.slice(boundary + 1);
}

function hitsIn(block: string, claim: ForbiddenClaim): string[] {
  const found: string[] = [];
  const scanner = new RegExp(claim.pattern.source, `${claim.pattern.flags}g`);
  for (const match of block.matchAll(scanner)) {
    if (claim.exemptIf?.test(clauseAround(block, match))) continue;
    found.push(match[0]);
  }
  return found;
}

const FORBIDDEN_CLAIMS: ForbiddenClaim[] = [
  {
    id: "server-role-may-write-the-tables",
    pattern: /service[_ -]role\s+is\s+the\s+only\s+role\s+that\s+may\s+write/i,
    why: "the helper preamble justified its grants by claiming service_role writes the tables",
    retired:
      "CHECK expressions are evaluated with the privileges of the writing role, and service_role is the only role that may write these tables, so each helper is revoked from every client role and granted to service_role.",
    permitted: [
      "A CHECK expression is evaluated with the privileges of the role performing the write, and after section J's convergence that role is always the ledger owner.",
    ],
  },
  {
    id: "server-role-holds-a-direct-write-privilege",
    pattern:
      /service[_ -]role\s+(?:holds|has|carries|keeps|retains)\s+(?:a\s+)?(?:direct\s+)?(?:INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER)\b/i,
    why: "a comment asserted the server role holds a write privilege it does not hold",
    retired:
      "that is a rule in one function, and service_role holds INSERT on this table directly.",
    permitted: [
      "service_role holds no INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, or TRIGGER on any table in this migration.",
      "Previously service_role held SELECT/INSERT/UPDATE/DELETE on these ledgers.",
      "That was acceptable when service_role also held DELETE; it is not a boundary on its own.",
      "service_role holds no write privilege on this table at all -- it is SELECT-only.",
    ],
  },
  {
    id: "bare-or-direct-server-role-write",
    pattern:
      /(?:bare|direct)\s+service[_ -]role\s+(?:statement|INSERT|UPDATE|DELETE|TRUNCATE|write)/i,
    why: "a comment described a bare or direct server-role write as a thing that still happens",
    retired:
      "These checks run for every UPDATE, including a bare service-role statement, so the RPCs are not the only thing standing between an operator and a rewritten audit trail.",
    permitted: [
      "These checks run for EVERY UPDATE that reaches this ledger -- including one the owner issues from a different RPC or a backfill.",
    ],
    // csf_comm_teardown_authorized()'s comment states the opposite of a grant:
    // owner-only authority is "never true for a direct service_role statement".
    // That is the contract, phrased around the same noun.
    exemptIf: /\bnever\s+true\s+for\b/i,
  },
  {
    id: "direct-server-role-write-runs-through-the-guard",
    pattern:
      /\bdirect\s+service[_ -]role\s+(?:INSERT|UPDATE|DELETE|statement)[^.;:]{0,60}\bruns?\s+through\b/i,
    why: "the terminalization guard claimed a direct server-role UPDATE reaches it just as the RPC does",
    retired:
      "A direct service_role UPDATE runs through it exactly as the RPC does, so the rule cannot be sidestepped by writing the status column yourself.",
    permitted: [
      "Runs for every UPDATE that reaches the table, including one the owner issues outside the finalization RPC.",
      "which is true only inside a SECURITY DEFINER purge function and never true for a direct service_role statement.",
    ],
  },
  {
    id: "server-role-write-in-the-terminalization-comment",
    pattern: /\bfor\s+direct\s+service[_ -]role\s+(?:INSERT|UPDATE|DELETE)s?\b/i,
    why: "the COMMENT ON FUNCTION said the guard runs for direct service_role UPDATEs too",
    retired:
      "Runs for direct service_role UPDATEs too, so the rule cannot be sidestepped.",
    permitted: [
      "Runs for every UPDATE that reaches the table, so the rule is not a property of a single function.",
    ],
  },
  {
    id: "server-role-may-or-can-write",
    pattern:
      /service[_ -]role\s+(?:may|can|could|is\s+able\s+to)\s+(?!not\b|never\b|no\b)(?:still\s+|also\s+|directly\s+)*(?:write|INSERT|UPDATE|DELETE|TRUNCATE)\b/i,
    why: "a comment granted the server role a write capability in the present tense",
    retired:
      "The rule is in one function only, and service_role can UPDATE the status column directly.",
    permitted: [
      "service_role cannot write the column at all; section J leaves it SELECT-only.",
      "the only thing standing between it and a wiped audit trail was a transaction-local GUC -- which service_role can set itself with set_config().",
    ],
  },
  {
    id: "present-tense-hole-left-open",
    pattern:
      /\bThat\s+is\s+a\s+real\s+hole\b|\bis\s+a\s+real\s+hole,\s*not\s+a\s+theoretical\s+one\b/i,
    why: "the cancellation converse described its historical hole as still open",
    retired:
      "so a bare service-role `UPDATE ... SET status = 'cancelled'` sailed straight through it. That is a real hole, not a theoretical one.",
    permitted: [
      "That WAS a real hole, not a theoretical one: it stopped the campaign in the UI while leaving every queued attempt claimable.",
    ],
  },
];

describe("the migration's privilege prose matches its final least-privilege contract", () => {
  test("every forbidden-claim detector still detects the sentence it retired", () => {
    // Anti-rot. A pattern that no longer matches its own historical sentence is a
    // dead guard, and a dead guard passes every check below for the wrong reason.
    for (const claim of FORBIDDEN_CLAIMS) {
      expect(
        hitsIn(claim.retired, claim),
        `detector ${claim.id} no longer flags the sentence it exists to catch`,
      ).not.toEqual([]);
    }
    expect(FORBIDDEN_CLAIMS.length).toBeGreaterThanOrEqual(7);
  });

  test("every detector flags every retired sentence it should, across the whole set", () => {
    // Each of the six passages this pass rewrote must be caught by at least one
    // detector. Checked as a set rather than per-detector so that merging or
    // renaming detectors later cannot silently drop coverage of a passage.
    for (const claim of FORBIDDEN_CLAIMS) {
      const caught = FORBIDDEN_CLAIMS.some(
        (candidate) => hitsIn(claim.retired, candidate).length > 0,
      );
      expect(caught, `no detector catches the retired sentence for ${claim.id}`).toBe(
        true,
      );
    }
  });

  test("no forbidden-claim detector fires on the truthful replacement prose", () => {
    // The other half of the calibration: a detector broad enough to reject the
    // honest sentence would be quietly reverted by the next person who hits it.
    for (const claim of FORBIDDEN_CLAIMS) {
      for (const allowed of claim.permitted) {
        expect(
          hitsIn(allowed, claim),
          `detector ${claim.id} is too broad: it rejects truthful prose -- ${allowed}`,
        ).toEqual([]);
      }
    }
  });

  test("the prose corpus actually captured the migration's commentary", () => {
    // Guards the whole file against degrading into a tautology if the corpus
    // extraction breaks and every scan below runs against an empty string.
    expect(proseCorpus.length).toBeGreaterThan(500);
    expect(proseText).toContain("SERVER-ONLY BOUNDARY");
    expect(proseText).toContain("ALL TEN LEDGERS ARE READ-ONLY TO service_role");
    // The COMMENT ON FUNCTION bodies are literals, not `--` lines. If only line
    // comments were captured, this anchor would be absent and the terminalization
    // regression would be invisible.
    expect(proseText).toContain(
      "The authority on CSF campaign terminalization.",
    );
  });

  test("no comment or diagnostic claims a direct table write privilege", () => {
    const found: string[] = [];
    for (const claim of FORBIDDEN_CLAIMS) {
      for (const block of proseCorpus) {
        for (const hit of hitsIn(block, claim)) {
          found.push(`${claim.id} (${claim.why}): ...${hit}...`);
        }
      }
    }
    expect(found, `stale direct-table-write prose returned:\n${found.join("\n")}`).toEqual(
      [],
    );
  });

  test("the prose states the least-privilege contract outright", () => {
    // The absence of a false claim is not the presence of a true one. These are
    // the three statements a reader auditing the write boundary needs to find.
    expect(proseText).toContain(
      "service_role holds no INSERT, UPDATE, DELETE,",
    );
    expect(proseText).toMatch(
      /service_role granted exactly\s+SELECT -- never INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, or TRIGGER/,
    );
    // Writes happen only through the owned RPC surface, which needs no grant.
    expect(proseText).toMatch(
      /Consequential writes go (?:through|exclusively through) the SECURITY DEFINER RPCs, which run as the ledger owner and (?:therefore )?need no\s+grant at all/,
    );
  });
});

// ---------------------------------------------------------------------------
// LAYER 2. The privileges themselves, parsed from the real statements.
//
// Prose that agrees with prose proves nothing. This reads the executable grant
// block, so a future migration statement that reopens a write privilege fails
// here even if every comment in the file is rewritten to match it.
// ---------------------------------------------------------------------------

const LEDGERS = [
  "plugin_data.csf_communication_broadcast_preferences",
  "plugin_data.csf_communication_preference_events",
  "plugin_data.csf_communication_address_safety",
  "plugin_data.csf_communication_address_safety_events",
  "plugin_data.csf_communication_webhook_quarantine",
  "plugin_data.csf_communication_dispatch_attempts",
  "plugin_data.csf_communication_campaigns",
  "plugin_data.csf_communication_recipient_snapshots",
  "plugin_data.csf_communication_deliveries",
  "plugin_data.csf_communication_provider_events",
] as const;

/** SQL with comments blanked, so statement scans never read commentary. */
function withoutComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => {
      const marker = line.indexOf("--");
      return marker === -1 ? line : line.slice(0, marker);
    })
    .join("\n");
}

const executableSql = withoutComments(migrationSql);

function tableListOf(statement: string): string[] {
  return [...statement.matchAll(/plugin_data\.csf_communication_[a-z_]+/g)]
    .map((match) => match[0])
    .sort();
}

describe("the executable grant block leaves every communications ledger read-only", () => {
  test("exactly one table-level GRANT exists, and it grants only SELECT", () => {
    const tableGrants = [
      ...executableSql.matchAll(/GRANT\s+([A-Z, ]+?)\s+ON\s+TABLE\b/gi),
    ].map((match) => match[1].trim().toUpperCase());

    expect(tableGrants).toEqual(["SELECT"]);
  });

  test("no statement grants a write privilege on a table to anybody", () => {
    // TRUNCATE bypasses every immutability trigger in one statement, and
    // REFERENCES/TRIGGER let a holder attach new structure to audited history.
    const forbidden = /GRANT\s+[^;]*\b(INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER|ALL)\b[^;]*\bON\s+TABLE\b/gi;
    expect([...executableSql.matchAll(forbidden)].map((m) => m[0])).toEqual([]);
  });

  test("all ten ledgers are revoked from every role including the server role", () => {
    const revoke = executableSql.match(/REVOKE\s+ALL\s+ON\s+TABLE[^;]*;/i);
    expect(revoke, "no REVOKE ALL ON TABLE block found").not.toBeNull();
    const statement = revoke![0];

    expect(tableListOf(statement)).toEqual([...LEDGERS].sort());
    for (const role of ["PUBLIC", "anon", "authenticated", "service_role"]) {
      expect(statement, `REVOKE omits ${role}`).toContain(role);
    }
  });

  test("the SELECT grant covers exactly those same ten ledgers", () => {
    const grant = executableSql.match(/GRANT\s+SELECT\s+ON\s+TABLE[^;]*;/i);
    expect(grant, "no GRANT SELECT ON TABLE block found").not.toBeNull();
    const statement = grant![0];

    expect(tableListOf(statement)).toEqual([...LEDGERS].sort());
    expect(statement).toContain("TO service_role");
    // Nothing else may be handed SELECT on a server-only ledger.
    expect(statement).not.toMatch(/\b(anon|authenticated|PUBLIC)\b/);
  });

  test("every base ledger has RLS enabled with no policy created", () => {
    for (const ledger of LEDGERS) {
      expect(
        executableSql,
        `${ledger} is not put behind row level security`,
      ).toContain(`ALTER TABLE ${ledger}\n  ENABLE ROW LEVEL SECURITY;`);
    }
    expect(executableSql).not.toMatch(/CREATE\s+POLICY/i);
  });
});

// ---------------------------------------------------------------------------
// LAYER 3. The purge result contracts, parsed from the function bodies.
//
// "Two additional keys" was the previous documentation, and a key COUNT is
// satisfied by the wrong key. The names below are the executable contract, and
// they are compared against the argument list the function actually builds --
// never against the comment that describes it.
// ---------------------------------------------------------------------------

const DURABLE_PURGE_KEYS = [
  "organizationId",
  "dispatchAttempts",
  "preferenceDecisionEvents",
  "broadcastPreferences",
  "addressSafetyEvents",
  "addressSafetyRecords",
  "webhookQuarantine",
] as const;

const RECOVERY_PURGE_KEYS = [
  "organizationId",
  "dispatchAttempts",
  "preferenceDecisionEvents",
  "broadcastPreferences",
  "addressSafetyEvents",
  "addressSafetyRecords",
  "webhookQuarantine",
  "providerEvents",
  "deliveries",
  "recipientSnapshots",
  "campaigns",
  "partnerClubTermEvents",
  "partnerClubRepresentatives",
  "calendarProjections",
] as const;

/** The body of one `CREATE OR REPLACE FUNCTION plugin_data.<name>`, to its `$$;`. */
function functionBody(name: string): string {
  const start = executableSql.indexOf(
    `CREATE OR REPLACE FUNCTION plugin_data.${name}(`,
  );
  expect(start, `function not found: ${name}`).toBeGreaterThan(-1);
  const end = executableSql.indexOf("\n$$;", start);
  expect(end, `unterminated body for ${name}`).toBeGreaterThan(start);
  return executableSql.slice(start, end);
}

/** Split an argument list on TOP-LEVEL commas only. */
function splitArguments(argumentList: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = "";

  for (let i = 0; i < argumentList.length; i += 1) {
    const ch = argumentList[i];
    if (quoted) {
      current += ch;
      if (ch === "'") {
        if (argumentList[i + 1] === "'") {
          current += "'";
          i += 1;
        } else {
          quoted = false;
        }
      }
      continue;
    }
    if (ch === "'") {
      quoted = true;
      current += ch;
      continue;
    }
    if (ch === "(" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "]") depth -= 1;

    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/**
 * The keys of the `RETURN pg_catalog.jsonb_build_object(...)` a purge body ends
 * with.
 *
 * Top-level splitting is what makes this exact. The recovery entry point's VALUES
 * are expressions like `coalesce((v_durable->>'dispatchAttempts')::integer, 0)`,
 * which carry quoted strings of their own -- a scan for every literal in the call
 * would read those as keys and report each name twice.
 */
function returnedKeys(name: string): string[] {
  const body = functionBody(name);
  const anchor = "RETURN pg_catalog.jsonb_build_object(";
  const start = body.lastIndexOf(anchor);
  expect(start, `no jsonb_build_object return in ${name}`).toBeGreaterThan(-1);

  let depth = 0;
  let end = -1;
  for (let i = start + anchor.length - 1; i < body.length; i += 1) {
    if (body[i] === "(") depth += 1;
    else if (body[i] === ")") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  expect(end, `unbalanced jsonb_build_object in ${name}`).toBeGreaterThan(start);

  const args = splitArguments(body.slice(start + anchor.length, end));
  expect(args.length % 2, `${name} builds an odd number of jsonb arguments`).toBe(0);

  return args
    .filter((_, index) => index % 2 === 0)
    .map((key) => {
      // A key must be a bare literal. A computed key would make the result
      // contract unreadable from the source, which is the whole point here.
      const literal = key.match(/^'([A-Za-z]+)'$/);
      expect(literal, `${name} builds a non-literal result key: ${key}`).not.toBeNull();
      return literal![1];
    });
}

describe("both purge functions return exactly the documented key set", () => {
  test("csf_purge_durable_communications(uuid) returns exactly its seven keys", () => {
    expect(returnedKeys("csf_purge_durable_communications")).toEqual([
      ...DURABLE_PURGE_KEYS,
    ]);
  });

  test("csf_purge_recovery_foundations(uuid) returns exactly its fourteen keys", () => {
    expect(returnedKeys("csf_purge_recovery_foundations")).toEqual([
      ...RECOVERY_PURGE_KEYS,
    ]);
  });

  test("the entry point forwards every one of the helper's keys", () => {
    // The helper's contract is not merely a subset of the entry point's by
    // coincidence: the entry point reads each of those keys back out of the
    // helper's jsonb. A key the helper reports and the entry point drops would be
    // a silently unreported deletion.
    const helperBody = functionBody("csf_purge_durable_communications");
    const entryBody = functionBody("csf_purge_recovery_foundations");

    for (const key of DURABLE_PURGE_KEYS) {
      if (key === "organizationId") continue;
      expect(
        entryBody,
        `the entry point never reads the helper's ${key}`,
      ).toContain(`v_durable->>'${key}'`);
      expect(helperBody, `the helper never reports ${key}`).toContain(`'${key}'`);
    }
  });

  test("each purge COMMENT names every key it returns, not a count of them", () => {
    const comments = new Map<string, string>();
    for (const match of migrationSql.matchAll(
      /COMMENT ON FUNCTION plugin_data\.(csf_purge_[a-z_]+)\(uuid\) IS\s+'((?:[^']|'')*)'/g,
    )) {
      comments.set(match[1], match[2].replace(/''/g, "'"));
    }

    expect([...comments.keys()].sort()).toEqual([
      "csf_purge_durable_communications",
      "csf_purge_recovery_foundations",
    ]);

    const expected: Array<[string, readonly string[]]> = [
      ["csf_purge_durable_communications", DURABLE_PURGE_KEYS],
      ["csf_purge_recovery_foundations", RECOVERY_PURGE_KEYS],
    ];

    for (const [name, keys] of expected) {
      const comment = comments.get(name)!;
      for (const key of keys) {
        expect(comment, `${name}'s COMMENT omits the key ${key}`).toContain(key);
      }
      // A count is not a contract. "two additional keys" was the documentation
      // this replaced, and it was satisfied by any two names at all.
      expect(comment).not.toMatch(
        /\b(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen)\s+(?:additional\s+|extra\s+|more\s+)?keys\b/i,
      );
      expect(comment).toContain("Returns EXACTLY these keys:");
    }
  });

  test("no comment names a purge function the migration does not define", () => {
    // A documented fixture or helper that does not exist reads as a supported
    // entry point and sends the next reader looking for a function nobody wrote.
    const defined = new Set(
      [
        ...executableSql.matchAll(
          /CREATE OR REPLACE FUNCTION plugin_data\.(csf_purge_[a-z_]+)\(/g,
        ),
      ].map((match) => match[1]),
    );
    expect([...defined].sort()).toEqual([
      "csf_purge_durable_communications",
      "csf_purge_recovery_foundations",
    ]);

    const named = new Set(
      [...proseText.matchAll(/plugin_data\.(csf_purge_[a-z_]+)/g)].map(
        (match) => match[1],
      ),
    );
    for (const name of named) {
      expect(defined.has(name), `prose names an undefined purge function: ${name}`).toBe(
        true,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// LAYER 4. The durable footprint, enumerated rather than summarized.
// ---------------------------------------------------------------------------

const CSF_CALENDAR_SOURCE_KINDS = [
  "csf_opportunity",
  "csf_meeting_session",
  "csf_deadline",
] as const;

const PURGE_TARGETS = [
  ...LEDGERS,
  "plugin_data.csf_partner_club_term_events",
  "plugin_data.csf_partner_club_representatives",
  "public.organization_calendar_events",
] as const;

describe("the purge documentation enumerates the whole durable footprint", () => {
  test("every table the two bodies delete is named in the section K header", () => {
    const header = migrationSql.slice(
      migrationSql.indexOf("-- K. Lifecycle purge integration"),
      migrationSql.indexOf(
        "CREATE OR REPLACE FUNCTION plugin_data.csf_purge_durable_communications(",
      ),
    );
    expect(header.length).toBeGreaterThan(400);

    for (const target of PURGE_TARGETS) {
      expect(header, `the purge header omits ${target}`).toContain(target);
    }
    for (const kind of CSF_CALENDAR_SOURCE_KINDS) {
      expect(header, `the purge header omits source_kind ${kind}`).toContain(kind);
    }
  });

  test("the two bodies delete from exactly the enumerated targets", () => {
    // The other direction, read off the executable statements. A body that grows a
    // new DELETE without the header growing a line fails here.
    const deletes = new Set<string>();
    for (const name of [
      "csf_purge_durable_communications",
      "csf_purge_recovery_foundations",
    ]) {
      for (const match of functionBody(name).matchAll(
        /DELETE FROM\s+((?:plugin_data|public)\.[a-z_]+)/g,
      )) {
        deletes.add(match[1]);
      }
    }
    expect([...deletes].sort()).toEqual([...PURGE_TARGETS].sort());
  });

  test("the calendar sweep is restricted to exactly the three CSF projections", () => {
    const body = functionBody("csf_purge_recovery_foundations");
    const sweep = body.slice(
      body.indexOf("DELETE FROM public.organization_calendar_events"),
    );
    const clause = sweep.slice(0, sweep.indexOf(";"));

    expect(clause).toContain("calendar_event.organization_id = p_organization_id");
    expect(clause).toContain("calendar_event.source_kind IN (");
    expect(sqlLiterals(clause).sort()).toEqual(
      [...CSF_CALENDAR_SOURCE_KINDS].sort(),
    );
  });
});
