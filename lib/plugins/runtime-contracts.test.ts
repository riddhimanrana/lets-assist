import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { assertPluginReleaseAlignment } = await import("./runtime-contracts");

const definition = {
  manifest: {
    key: "synthetic-plugin",
    version: "1.2.3",
  },
};

describe("plugin runtime release alignment", () => {
  test("accepts an active catalog backed by the exact published release", () => {
    expect(() =>
      assertPluginReleaseAlignment({
        definitions: [definition as never],
        catalogRows: [
          {
            key: "synthetic-plugin",
            latest_version: "1.2.3",
            is_active: true,
          },
        ],
        publishedRows: [{ plugin_key: "synthetic-plugin", version: "1.2.3" }],
      }),
    ).not.toThrow();
  });

  test("rejects catalog, manifest, and publication drift", () => {
    expect(() =>
      assertPluginReleaseAlignment({
        definitions: [definition as never],
        catalogRows: [
          {
            key: "synthetic-plugin",
            latest_version: "1.2.2",
            is_active: true,
          },
        ],
        publishedRows: [{ plugin_key: "synthetic-plugin", version: "1.2.3" }],
      }),
    ).toThrow("does not match catalog");

    expect(() =>
      assertPluginReleaseAlignment({
        definitions: [definition as never],
        catalogRows: [
          {
            key: "synthetic-plugin",
            latest_version: "1.2.3",
            is_active: true,
          },
        ],
        publishedRows: [],
      }),
    ).toThrow("no authoritative published release");
  });
});
