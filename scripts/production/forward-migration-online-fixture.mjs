import {
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { approvedMigrations } from "./forward-migration-allowlist.mjs";
import { historicalReleaseTestFixture } from "./historical-release-test-fixture.mjs";

// Exercise today's controller with a retained historical release approval.
// Only the disposable fixture has an older ledger and approval list.
export async function historicalOnlineReleaseTestFixture(
  throughVersion = "20261007200000",
) {
  const fixture = historicalReleaseTestFixture();
  try {
    const migrations = approvedMigrations.filter(
      ([name]) => name.slice(0, 14) <= throughVersion,
    );
    const directory = resolve(fixture.cwd, "supabase/migrations");
    for (const name of readdirSync(directory)) {
      if (name.slice(0, 14) > throughVersion)
        unlinkSync(resolve(directory, name));
    }
    unlinkSync(resolve(fixture.cwd, "scripts"));
    const scripts = resolve(fixture.cwd, "scripts/production");
    mkdirSync(scripts, { recursive: true });
    for (const name of readdirSync(import.meta.dirname)) {
      if (
        [
          "forward-migration-release.mjs",
          "forward-migration-allowlist.mjs",
        ].includes(name)
      )
        continue;
      symlinkSync(resolve(import.meta.dirname, name), resolve(scripts, name));
    }
    writeFileSync(
      resolve(scripts, "forward-migration-release.mjs"),
      readFileSync(new URL("./forward-migration-release.mjs", import.meta.url)),
    );
    writeFileSync(
      resolve(scripts, "forward-migration-allowlist.mjs"),
      `export const approvedMigrations = ${JSON.stringify(migrations)};\n`,
    );
    return {
      ...fixture,
      controller: await import(
        pathToFileURL(resolve(scripts, "forward-migration-release.mjs")).href
      ),
    };
  } catch (error) {
    fixture.dispose();
    throw error;
  }
}
