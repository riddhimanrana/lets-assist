import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

import { validatePluginSdkManifest } from "@/lib/plugins/sdk/v1/schema";
import {
  adoptionFromPublishedRelease,
  currentHostSupports,
  embeddedPluginAdoptions,
} from "@/lib/plugins/sdk-adoption";
import { getPublishedPluginRelease } from "@/lib/plugins/published-releases";
import { isPluginVersionWithinContractRange } from "@/lib/plugins/sdk/v1/compatibility";
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

    test(`${key} keeps bootstrap provenance unknown`, () => {
      const adoption = embeddedPluginAdoptions[key];
      const release = getPublishedPluginRelease(key);

      expect(release).toBeDefined();
      if (!release) throw new Error(`Missing published release for ${key}`);
      expect(release.signer).toBeNull();
      expect(release.releaseInputs).toBeNull();
      expect(release.requiredPlatformSchemaVersion).toBe("legacy");
      expect(
        isPluginVersionWithinContractRange(
          definition.manifest.version,
          adoption.supportedInstallContracts,
        ),
      ).toBe(true);
      expect(release.version).toBe(definition.manifest.version);
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

describe("embedded host API compatibility", () => {
  test("accepts only ranges that contain the current host API", () => {
    expect(currentHostSupports({ minimum: "1.0.0" })).toBe(true);
    expect(currentHostSupports({ minimum: "1.0.0", maximum: "1.0.0" })).toBe(
      true,
    );
    expect(currentHostSupports({ minimum: "1.1.0" })).toBe(false);
    expect(currentHostSupports({ minimum: "0.9.0", maximum: "0.9.9" })).toBe(
      false,
    );
  });

  test("a signed release replaces every bootstrap adoption field", () => {
    const current = getPublishedPluginRelease("dvhs-csf");
    if (!current) throw new Error("Missing DVHS CSF release fixture");
    const signed = {
      ...current,
      signer: {
        identity: "https://github.com/example/release.yml@refs/tags/v1.2.0",
        issuer: "https://token.actions.githubusercontent.com",
        attestationRef: "github-release:v1.2.0/bundle.json",
      },
      hostApiRange: { minimum: "1.0.0", maximum: "1.0.0" },
      pluginDataSchemaVersion: 2,
      requiredPlatformSchemaVersion: "20260820000000",
      supportedInstallContracts: { minimum: "1.1.0", maximum: "1.2.0" },
      releaseInputs: ["plugins/dvhs-csf", "apps/csf"],
    };

    expect(adoptionFromPublishedRelease("dvhs-csf", signed)).toEqual({
      hostApiRange: signed.hostApiRange,
      pluginDataSchemaVersion: 2,
      requiredPlatformSchemaVersion: "20260820000000",
      supportedInstallContracts: signed.supportedInstallContracts,
      releaseInputs: signed.releaseInputs,
    });
  });
});
