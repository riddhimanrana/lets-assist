import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { buildPluginStoragePath } from "./storage-path";

/**
 * The private plugin repository shipped the storage helper first, in
 * `plugin-storage.ts`. The SDK now owns the canonical plugin-key grammar so an
 * independently deployed application can address storage without importing
 * host or private code.
 *
 * The embedded helper still accepts legacy `.` and `_` key punctuation. No
 * registered manifest can use those keys, and its production call sites pass
 * the fixed `dvhs-csf` key. These tests make the canonical intersection and
 * legacy-only difference explicit until a private release can consume the SDK.
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
    "both implementations agree for canonical keys and tenant suffixes",
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

  test.skipIf(!submodulePresent)(
    "the SDK rejects legacy private-only plugin-key punctuation",
    async () => {
      const privateModule = (await import(privateModulePath)) as {
        buildPrivatePluginStoragePath: (input: {
          organizationId: string;
          pluginKey: string;
          suffix: string;
        }) => string;
      };

      for (const pluginKey of ["legacy_plugin", "legacy.plugin"]) {
        expect(
          attempt(() =>
            privateModule.buildPrivatePluginStoragePath({
              organizationId: ORG,
              pluginKey,
              suffix: "file.pdf",
            }),
          ).ok,
        ).toBe(true);
        expect(
          attempt(() =>
            buildPluginStoragePath({
              organizationId: ORG,
              pluginKey,
              resource: "file.pdf",
            }),
          ).ok,
        ).toBe(false);
      }
    },
  );
});
