import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  APPROVED_TAIL,
  REVIEWED_PREFIX_LENGTH,
} from "./forward-migration-release-fixture.mjs";

// Historical release tests must not implicitly approve new platform migrations.
// Keep their filesystem ledger at the reviewed boundary while reading the real,
// immutable SQL bytes so the controller's digest checks still run unchanged.
export function historicalReleaseTestFixture() {
  const repository = resolve(import.meta.dirname, "../..");
  const names = readdirSync(resolve(repository, "supabase/migrations"))
    .filter((name) => /^\d{14}_.+\.sql$/u.test(name))
    .sort();
  const versions = new Set([
    ...names.slice(0, REVIEWED_PREFIX_LENGTH).map((name) => name.slice(0, 14)),
    ...APPROVED_TAIL,
  ]);
  const approvedNames = names.filter((name) => versions.has(name.slice(0, 14)));
  if (approvedNames.length !== REVIEWED_PREFIX_LENGTH + APPROVED_TAIL.length)
    throw new Error(
      "Historical release fixture is missing approved migrations",
    );
  const directory = mkdtempSync(resolve(tmpdir(), "historical-release-test-"));
  try {
    mkdirSync(resolve(directory, "supabase/migrations"), { recursive: true });
    for (const name of approvedNames)
      symlinkSync(
        resolve(repository, "supabase/migrations", name),
        resolve(directory, "supabase/migrations", name),
      );
    for (const name of ["scripts", ".github"])
      symlinkSync(resolve(repository, name), resolve(directory, name), "dir");
    return {
      cwd: `${directory}/`,
      dispose: () => rmSync(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}
