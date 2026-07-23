#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const CANONICAL_EMPTY_SEED = "supabase/seed.sql";
const CANONICAL_LOCAL_SEED = "supabase/seeds/local-only.sql";
const CANONICAL_CONFIG = "supabase/config.toml";
const TRACKED_SEED_SCRIPTS = new Set([
  "scripts/local-dev/seed-dvsd.mjs",
  "scripts/local-dev/seed-platform.mjs",
]);

const RESERVED_EMAIL_DOMAINS = new Set([
  "example.com",
  "example.net",
  "example.org",
]);

const RULES = Object.freeze({
  EXECUTABLE_CANONICAL_SEED: "executable-canonical-seed",
  UNEXPECTED_SEED_PATH: "unexpected-seed-path",
  INVALID_SEED_CONFIG: "invalid-seed-config",
  EMAIL: "non-fictional-email",
  PHONE: "phone-value",
  OAUTH_TOKEN: "oauth-or-bearer-token",
  REUSABLE_INVITATION: "reusable-invitation-material",
  PRODUCTION_SUPABASE_URL: "production-supabase-url",
});

/**
 * The only non-.test email domains accepted in tracked seed SQL are the IANA
 * example domains above. They cannot receive mail and are reserved for docs.
 * There are deliberately no token, phone, or Supabase URL allowlists.
 */
export const SEED_SAFETY_ALLOWLIST = Object.freeze({
  emailDomains: [...RESERVED_EMAIL_DOMAINS].sort(),
});

function normalizeRepoPath(filePath) {
  return filePath.split(path.sep).join("/").replace(/^\.\//, "");
}

function lineNumberAt(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function createFinding(file, rule, message, source, index = 0) {
  return {
    file: normalizeRepoPath(file),
    line: lineNumberAt(source, Math.max(0, index)),
    message,
    rule,
  };
}

function sortFindings(findings) {
  return findings.sort((left, right) =>
    left.file.localeCompare(right.file) ||
    left.line - right.line ||
    left.rule.localeCompare(right.rule) ||
    left.message.localeCompare(right.message),
  );
}

export function stripSqlComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--[^\r\n]*/g, "");
}

export function isTrackedSeedSql(file) {
  const normalized = normalizeRepoPath(file);
  if (!normalized.startsWith("supabase/") || !normalized.endsWith(".sql")) {
    return false;
  }
  if (
    normalized === CANONICAL_EMPTY_SEED ||
    normalized.startsWith("supabase/seeds/")
  ) {
    return true;
  }
  return /(?:^|[/_.-])seed(?:s|ed|ing)?(?:[/_.-]|$)/i.test(normalized);
}

function collectRegexFindings({ file, source, expression, rule, message }) {
  const findings = [];
  expression.lastIndex = 0;
  for (const match of source.matchAll(expression)) {
    findings.push(
      createFinding(file, rule, message(match), source, match.index ?? 0),
    );
  }
  return findings;
}

function scanEmails(file, source) {
  return collectRegexFindings({
    file,
    source,
    expression: /\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi,
    rule: RULES.EMAIL,
    message(match) {
      const email = match[0].toLowerCase();
      const domain = match[1].toLowerCase();
      if (domain.endsWith(".test") || RESERVED_EMAIL_DOMAINS.has(domain)) {
        return null;
      }
      return `Use a .test address instead of ${email}.`;
    },
  }).filter((finding) => finding.message !== null);
}

function scanQuotedPhoneValues(file, source) {
  const findings = [];
  const quotedValue = /'(?:''|[^'])*'|"(?:\\.|[^"\\])*"/g;
  for (const match of source.matchAll(quotedValue)) {
    const value = match[0].slice(1, -1);
    const digits = value.replace(/\D/g, "");
    const phoneShaped =
      /^\+[\d ().-]+$/.test(value) ||
      /^\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}$/.test(value) ||
      /^\d{10,15}$/.test(value);
    if (phoneShaped && digits.length >= 10 && digits.length <= 15) {
      findings.push(
        createFinding(
          file,
          RULES.PHONE,
          "Replace phone-like seed data with a non-contactable fictional value or omit it.",
          source,
          match.index ?? 0,
        ),
      );
    }
  }
  return findings;
}

function scanOAuthAndBearerTokens(file, source) {
  const expressions = [
    /\bBearer\s+[A-Z0-9._~+/=-]{16,}/gi,
    /\bya29\.[A-Z0-9_-]{10,}/gi,
    /\b1\/\/[A-Z0-9_-]{10,}/gi,
    /\beyJ[A-Z0-9_-]{8,}\.[A-Z0-9_-]{8,}\.[A-Z0-9_-]{8,}\b/gi,
    /\b(?:access|refresh|oauth)[_-]?token\b\s*(?:=>|:=|=|:)\s*['"][^'"\r\n]{8,}['"]/gi,
  ];
  return expressions.flatMap((expression) =>
    collectRegexFindings({
      file,
      source,
      expression,
      rule: RULES.OAUTH_TOKEN,
      message: () =>
        "Remove bearer/OAuth access or refresh token material from tracked seed data.",
    }),
  );
}

function scanInvitationMaterial(file, source) {
  return collectRegexFindings({
    file,
    source,
    expression:
      /\b(?:join|invite|invitation|claim|connect)[_-]?(?:token|code)\b\s*(?:=>|:=|=|:)\s*['"][A-Z0-9_-]{6,}['"]/gi,
    rule: RULES.REUSABLE_INVITATION,
    message: () =>
      "Remove reusable invitation or join material; generate it at runtime instead.",
  });
}

function matchingParenthesis(source, openingIndex) {
  let depth = 0;
  let quote = null;
  for (let index = openingIndex; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) {
        if (quote === "'" && source[index + 1] === "'") {
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function splitTopLevelCommaList(source) {
  const values = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) {
        if (quote === "'" && source[index + 1] === "'") {
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
    } else if (character === "," && depth === 0) {
      values.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  values.push(source.slice(start).trim());
  return values;
}

function isFixedSqlString(value) {
  return /^'(?:''|[^'])*'$/.test(value) || /^"(?:\\.|[^"\\])*"$/.test(value);
}

function scanSensitiveInsertRows(file, source) {
  const findings = [];
  const insertStart = /\binsert\s+into\s+[A-Z0-9_."]+\s*\(/gi;
  const oauthColumns = new Set([
    "access_token",
    "oauth_access_token",
    "oauth_refresh_token",
    "refresh_token",
  ]);
  const invitationColumns = new Set([
    "claim_token",
    "connect_code",
    "invitation_code",
    "invitation_token",
    "invite_code",
    "invite_token",
    "join_code",
    "join_token",
  ]);

  for (const match of source.matchAll(insertStart)) {
    const columnsStart = (match.index ?? 0) + match[0].lastIndexOf("(");
    const columnsEnd = matchingParenthesis(source, columnsStart);
    if (columnsEnd < 0) {
      continue;
    }
    const columns = splitTopLevelCommaList(
      source.slice(columnsStart + 1, columnsEnd),
    ).map((column) => column.replaceAll('"', "").trim().toLowerCase());
    const valuesKeyword = source.slice(columnsEnd + 1).match(/^\s*values\b/i);
    if (!valuesKeyword) {
      continue;
    }

    let cursor = columnsEnd + 1 + valuesKeyword[0].length;
    while (cursor < source.length) {
      while (/\s|,/.test(source[cursor] ?? "")) {
        cursor += 1;
      }
      if (source[cursor] !== "(") {
        break;
      }
      const tupleEnd = matchingParenthesis(source, cursor);
      if (tupleEnd < 0) {
        break;
      }
      const values = splitTopLevelCommaList(source.slice(cursor + 1, tupleEnd));

      columns.forEach((column, index) => {
        const value = values[index]?.trim();
        if (!value || !isFixedSqlString(value)) {
          return;
        }
        if (oauthColumns.has(column)) {
          findings.push(
            createFinding(
              file,
              RULES.OAUTH_TOKEN,
              `Remove fixed ${column} material from tracked seed rows.`,
              source,
              cursor,
            ),
          );
        }
        if (invitationColumns.has(column)) {
          findings.push(
            createFinding(
              file,
              RULES.REUSABLE_INVITATION,
              `Remove fixed ${column} material; generate it at runtime instead.`,
              source,
              cursor,
            ),
          );
        }
      });
      cursor = tupleEnd + 1;
    }
  }
  return findings;
}

function scanSupabaseUrls(file, source) {
  return collectRegexFindings({
    file,
    source,
    expression: /https:\/\/([a-z0-9-]+)\.supabase\.co\b/gi,
    rule: RULES.PRODUCTION_SUPABASE_URL,
    message(match) {
      const host = `${match[1].toLowerCase()}.supabase.co`;
      if (host === "example.supabase.co") {
        return null;
      }
      return `Remove hosted Supabase URL ${host} from tracked seed data.`;
    },
  }).filter((finding) => finding.message !== null);
}

export function scanSeedSql(file, source) {
  const normalized = normalizeRepoPath(file);
  const findings = [];

  if (
    normalized === CANONICAL_EMPTY_SEED &&
    stripSqlComments(source).trim().length > 0
  ) {
    findings.push(
      createFinding(
        normalized,
        RULES.EXECUTABLE_CANONICAL_SEED,
        `${CANONICAL_EMPTY_SEED} must contain comments and whitespace only.`,
        source,
      ),
    );
  }

  if (
    normalized.startsWith("supabase/seeds/") &&
    normalized !== CANONICAL_LOCAL_SEED
  ) {
    findings.push(
      createFinding(
        normalized,
        RULES.UNEXPECTED_SEED_PATH,
        `Only ${CANONICAL_LOCAL_SEED} may contain reset-time SQL fixtures.`,
        source,
      ),
    );
  }

  findings.push(
    ...scanEmails(normalized, source),
    ...scanQuotedPhoneValues(normalized, source),
    ...scanOAuthAndBearerTokens(normalized, source),
    ...scanInvitationMaterial(normalized, source),
    ...scanSensitiveInsertRows(normalized, source),
    ...scanSupabaseUrls(normalized, source),
  );

  return sortFindings(findings);
}

export function scanSeedScript(file, source) {
  const normalized = normalizeRepoPath(file);
  return sortFindings([
    ...scanEmails(normalized, source),
    ...scanQuotedPhoneValues(normalized, source),
    ...scanOAuthAndBearerTokens(normalized, source),
    ...scanInvitationMaterial(normalized, source),
    ...scanSupabaseUrls(normalized, source),
  ]);
}

export function validateSeedConfig(source) {
  const configWithoutComments = source.replace(/#[^\r\n]*/g, "");
  const seedSection = configWithoutComments.match(
    /\[db\.seed\]([\s\S]*?)(?=\n\[[^\]]+\]|$)/,
  );
  if (!seedSection) {
    return [
      createFinding(
        CANONICAL_CONFIG,
        RULES.INVALID_SEED_CONFIG,
        "Missing [db.seed] configuration.",
        source,
      ),
    ];
  }

  const configuredPaths = [...seedSection[1].matchAll(/["']([^"']+\.sql)["']/g)]
    .map((match) => match[1])
    .sort();
  if (
    configuredPaths.length !== 1 ||
    configuredPaths[0] !== "./seeds/local-only.sql"
  ) {
    return [
      createFinding(
        CANONICAL_CONFIG,
        RULES.INVALID_SEED_CONFIG,
        `db.seed.sql_paths must contain only ./seeds/local-only.sql (found: ${configuredPaths.join(", ") || "none"}).`,
        source,
        seedSection.index ?? 0,
      ),
    ];
  }
  return [];
}

function trackedFiles(cwd) {
  const result = spawnSync("git", [
    "ls-files",
    "-z",
    "--",
    "supabase",
    ...TRACKED_SEED_SCRIPTS,
  ], {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "git ls-files failed");
  }
  return result.stdout
    .split("\0")
    .filter(Boolean)
    .map(normalizeRepoPath)
    .sort();
}

export function checkSupabaseSeedSafety({
  cwd = process.cwd(),
  files = trackedFiles(cwd),
  readFile = (file) => readFileSync(path.join(cwd, file), "utf8"),
} = {}) {
  const findings = [];
  const requiredPaths = [CANONICAL_EMPTY_SEED, CANONICAL_LOCAL_SEED];

  for (const requiredPath of requiredPaths) {
    if (!files.includes(requiredPath)) {
      findings.push({
        file: requiredPath,
        line: 1,
        message: `Required tracked seed file ${requiredPath} is missing.`,
        rule: RULES.UNEXPECTED_SEED_PATH,
      });
    }
  }

  for (const file of files.filter(isTrackedSeedSql)) {
    findings.push(...scanSeedSql(file, readFile(file)));
  }
  for (const file of files.filter((candidate) => TRACKED_SEED_SCRIPTS.has(candidate))) {
    findings.push(...scanSeedScript(file, readFile(file)));
  }

  if (!files.includes(CANONICAL_CONFIG)) {
    findings.push({
      file: CANONICAL_CONFIG,
      line: 1,
      message: `Required tracked config ${CANONICAL_CONFIG} is missing.`,
      rule: RULES.INVALID_SEED_CONFIG,
    });
  } else {
    findings.push(...validateSeedConfig(readFile(CANONICAL_CONFIG)));
  }

  return sortFindings(findings);
}

function formatFinding(finding) {
  return `${finding.file}:${finding.line} [${finding.rule}] ${finding.message}`;
}

const isEntrypoint = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isEntrypoint) {
  const findings = checkSupabaseSeedSafety();
  if (findings.length > 0) {
    console.error("Supabase seed safety check failed:\n");
    for (const finding of findings) {
      console.error(`- ${formatFinding(finding)}`);
    }
    process.exitCode = 1;
  } else {
    console.log("Supabase seed safety check passed.");
  }
}

export { RULES };
