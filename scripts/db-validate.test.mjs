import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("./db-validate.sh", import.meta.url));
function validate(files) {
  const cwd = mkdtempSync(join(tmpdir(), "csf-migration-lint-"));
  try {
    mkdirSync(join(cwd, "supabase/migrations"), { recursive: true });
    for (const name of files)
      writeFileSync(
        join(cwd, "supabase/migrations", name),
        "-- Synthetic migration\nSELECT 1;\n",
      );
    const bin = join(cwd, "bin");
    mkdirSync(bin);
    for (const command of ["bun", "supabase", "docker"])
      writeFileSync(
        join(bin, command),
        '#!/bin/sh\ntouch "$PWD/external-command-called"\nexit 91\n',
        { mode: 0o700 },
      );
    const result = spawnSync("bash", [script], {
      cwd,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      encoding: "utf8",
    });
    assert.equal(
      existsSync(join(cwd, "external-command-called")),
      false,
      "validation must not call package scripts, Supabase, or Docker",
    );
    return result;
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}
test("migration validation is non-mutating and does not claim replay proof", () => {
  const result = validate(["20260906000000_synthetic.sql"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /No database was changed/);
  assert.match(result.stdout, /Replay and security checks were not run/);
});
test("invalid migration names fail without database access", () => {
  assert.equal(validate(["invalid.sql"]).status, 1);
});
test("duplicate migration versions fail without database access", () => {
  assert.equal(
    validate(["20260906000000_one.sql", "20260906000000_two.sql"]).status,
    1,
  );
});
test("the scripts guide distinguishes file validation from database replay", () => {
  const guide = readFileSync(new URL("./README.md", import.meta.url), "utf8");
  assert.match(
    guide,
    /This command does not reset a database, replay migrations/,
  );
  assert.match(guide, /bun run db:test:redesign/);
  assert.doesNotMatch(
    guide,
    /Migration replay successful|Tests migration replay with local reset/,
  );
});
