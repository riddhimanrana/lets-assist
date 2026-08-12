import { describe, expect, test } from "bun:test";

import { buildPluginDataDeletionConfirmationPhrase } from "./plugin-data-deletion-confirmation";

describe("buildPluginDataDeletionConfirmationPhrase", () => {
  test("binds same-named organizations and plugins to distinct stable identities", () => {
    const first = buildPluginDataDeletionConfirmationPhrase(
      "Shared Name",
      "d1000000-0000-4000-8000-000000000001",
      "test-plugin",
    );
    const second = buildPluginDataDeletionConfirmationPhrase(
      "Shared Name",
      "d1000000-0000-4000-8000-000000000002",
      "test-plugin",
    );

    expect(first).not.toBe(second);
    expect(first).toBe(
      "Shared Name/d1000000-0000-4000-8000-000000000001/test-plugin",
    );
  });
});
