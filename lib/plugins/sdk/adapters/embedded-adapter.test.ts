import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

import { validatePluginSdkManifest } from "@/lib/plugins/sdk/v1/schema";
import { embeddedPluginAdoptions } from "@/lib/plugins/sdk-adoption";
import { adoptEmbeddedPlugin, toSdkManifest } from "./embedded";

const { listRegisteredPlugins } = await import("@/lib/plugins/registry");

/**
 * The point of the SDK is that it describes real plugins, not a hypothetical
 * one. These assertions run against the actual private plugin definitions, so
 * the contract cannot drift away from what the platform ships.
 *
 * Definitions come through the registry rather than `private/registry`
 * directly: the private registry sits in an import cycle with this module, so
 * entering from that side leaves `privatePlugins` uninitialized. The cycle
 * predates this contract and is recorded as a separate finding.
 */

const privatePlugins = listRegisteredPlugins();

describe("embedded adapter over the real private plugins", () => {
  test("both private plugins are registered", () => {
    // Guards against the suite passing vacuously if the submodule is empty.
    expect(privatePlugins.length).toBe(2);
  });

  for (const definition of privatePlugins) {
    const key = definition.manifest.key;

    test(`${key} declares an adoption`, () => {
      expect(embeddedPluginAdoptions[key]).toBeDefined();
    });

    test(`${key} satisfies the serializable contract`, () => {
      const result = validatePluginSdkManifest(
        toSdkManifest(definition, embeddedPluginAdoptions[key]),
      );

      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    });

    test(`${key} adopts without losing its identity`, () => {
      const pkg = adoptEmbeddedPlugin(definition, embeddedPluginAdoptions[key]);

      expect(pkg.sdk.key).toBe(key);
      expect(pkg.sdk.version).toBe(definition.manifest.version);
      expect(pkg.sdk.runtime.profile).toBe("embedded");
      expect(pkg.definition).toBe(definition);
    });

    test(`${key} starts at an exact install contract`, () => {
      // Adoption must reproduce the previous exact-match runtime gate. A range
      // wider than the manifest version here would silently change which
      // organizations the deployed code serves.
      const adoption = embeddedPluginAdoptions[key];

      expect(adoption.supportedInstallContracts.minimum).toBe(
        definition.manifest.version,
      );
      expect(adoption.supportedInstallContracts.maximum).toBe(
        definition.manifest.version,
      );
    });

    test(`${key} carries no unserializable value into the contract`, () => {
      const sdk = toSdkManifest(definition, embeddedPluginAdoptions[key]);

      // Round-tripping through JSON is the honest test of serializability: a
      // renderer or a client would either throw or vanish here.
      expect(JSON.parse(JSON.stringify(sdk))).toEqual(sdk);
    });
  }
});

describe("adoption refuses an inconsistent contract", () => {
  const [definition] = privatePlugins;
  const adoption = embeddedPluginAdoptions[definition.manifest.key];

  test("rejects release inputs that do not cover the plugin subtree", () => {
    expect(() =>
      adoptEmbeddedPlugin(definition, {
        ...adoption,
        releaseInputs: ["plugins/some-other-plugin"],
      }),
    ).toThrow(/releaseInputs/u);
  });

  test("rejects an inverted install-contract range", () => {
    expect(() =>
      adoptEmbeddedPlugin(definition, {
        ...adoption,
        supportedInstallContracts: { minimum: "9.0.0", maximum: "1.0.0" },
      }),
    ).toThrow(/supportedInstallContracts/u);
  });
});
