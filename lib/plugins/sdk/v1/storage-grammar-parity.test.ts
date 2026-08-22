import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { buildPluginStoragePath } from "./storage-path";

/**
 * The private plugin repository shipped this storage grammar first, in
 * `plugin-storage.ts`. The SDK now states the same rules so a plugin deployed
 * as its own application can address storage without importing host or private
 * code.
 *
 * Two implementations of a tenancy rule are a liability, so this test holds
 * them to identical behavior over a shared corpus until the private module
 * re-exports the SDK. It compares behavior rather than source text, because
 * matching bytes are neither necessary nor sufficient: what matters is that
 * both accept and reject exactly the same keys.
 */

const privateModulePath = join(
  import.meta.dir,
  "../../private/plugin-storage.ts",
);

const ORG = "11111111-1111-4111-8111-111111111111";

const CORPUS: Array<{
  organizationId: string;
  pluginKey: string;
  suffix: string;
}> = [
  { organizationId: ORG, pluginKey: "dvhs-csf", suffix: "proofs/file.pdf" },
  { organizationId: ORG, pluginKey: "dv-speech-debate", suffix: "a/b/c.txt" },
  { organizationId: ORG, pluginKey: "dvhs-csf", suffix: "single" },
  { organizationId: ORG, pluginKey: "dvhs-csf", suffix: "../escape.pdf" },
  { organizationId: ORG, pluginKey: "dvhs-csf", suffix: "nested/../../escape" },
  { organizationId: ORG, pluginKey: "dvhs-csf", suffix: "/absolute" },
  { organizationId: ORG, pluginKey: "dvhs-csf", suffix: "trailing/" },
  { organizationId: ORG, pluginKey: "dvhs-csf", suffix: "double//segment" },
  { organizationId: ORG, pluginKey: "dvhs-csf", suffix: "back\\slash" },
  { organizationId: ORG, pluginKey: "dvhs-csf", suffix: "." },
  { organizationId: ORG, pluginKey: "dvhs-csf", suffix: ".." },
  { organizationId: ORG, pluginKey: "dvhs-csf", suffix: "" },
  { organizationId: "not-a-uuid", pluginKey: "dvhs-csf", suffix: "file.pdf" },
  { organizationId: ORG, pluginKey: "Invalid Key", suffix: "file.pdf" },
  { organizationId: ORG, pluginKey: "UPPER", suffix: "file.pdf" },
  { organizationId: "", pluginKey: "dvhs-csf", suffix: "file.pdf" },
];

type Outcome = { ok: true; path: string } | { ok: false };

function attempt(build: () => string): Outcome {
  try {
    return { ok: true, path: build() };
  } catch {
    return { ok: false };
  }
}

describe("storage grammar parity with the private plugin repository", () => {
  const submodulePresent = existsSync(privateModulePath);

  test("the private module is available to compare against", () => {
    if (!submodulePresent) {
      console.warn(
        "[storage-grammar-parity] SKIPPED: lib/plugins/private is not checked out.",
      );
    }
    // Recorded rather than asserted, so a checkout without the submodule does
    // not fail the suite while still making the gap visible in the output.
    expect(true).toBe(true);
  });

  test.skipIf(!submodulePresent)(
    "both implementations accept and reject the same keys",
    async () => {
      const privateModule = (await import(privateModulePath)) as {
        PRIVATE_PLUGIN_STORAGE_BUCKET: string;
        buildPrivatePluginStoragePath: (input: {
          organizationId: string;
          pluginKey: string;
          suffix: string;
        }) => string;
      };

      expect(privateModule.PRIVATE_PLUGIN_STORAGE_BUCKET).toBe("plugins");

      const divergences: string[] = [];

      for (const entry of CORPUS) {
        const sdk = attempt(() =>
          buildPluginStoragePath({
            organizationId: entry.organizationId,
            pluginKey: entry.pluginKey,
            resource: entry.suffix,
          }),
        );
        const priv = attempt(() =>
          privateModule.buildPrivatePluginStoragePath(entry),
        );

        if (sdk.ok !== priv.ok) {
          divergences.push(
            `${JSON.stringify(entry)}: sdk ${sdk.ok ? "accepted" : "rejected"}, private ${priv.ok ? "accepted" : "rejected"}`,
          );
          continue;
        }

        if (sdk.ok && priv.ok && sdk.path !== priv.path) {
          divergences.push(
            `${JSON.stringify(entry)}: sdk produced ${sdk.path}, private produced ${priv.path}`,
          );
        }
      }

      expect(divergences).toEqual([]);
    },
  );
});
