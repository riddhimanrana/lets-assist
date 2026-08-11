import { describe, expect, test } from "bun:test";

import {
  DEFAULT_PLUGIN_DISPLAY_PREFERENCES,
  isPluginHidden,
  loadPluginDisplayPreferences,
  nextHiddenPluginKeys,
} from "@/lib/plugins/plugin-display-preferences";

type Row = Record<string, unknown>;

/** Minimal PostgREST stand-in: `.from().select().eq()` resolves to a result. */
function client(result: { data: Row[] | null; error: unknown }) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    then: (resolve: (value: typeof result) => unknown) => resolve(result),
  };
  return { from: () => chain } as never;
}

describe("loadPluginDisplayPreferences", () => {
  test("no row means plugin content is shown", async () => {
    expect(
      await loadPluginDisplayPreferences(
        client({ data: [], error: null }),
        "user-1",
      ),
    ).toEqual(DEFAULT_PLUGIN_DISPLAY_PREFERENCES);
  });

  test("reads the stored switch and opt-out list", async () => {
    expect(
      await loadPluginDisplayPreferences(
        client({
          data: [
            { show_plugin_content: false, hidden_plugin_keys: ["a", "b"] },
          ],
          error: null,
        }),
        "user-1",
      ),
    ).toEqual({ showPluginContent: false, hiddenPluginKeys: ["a", "b"] });
  });

  test("drops blank and non-string keys and de-duplicates", async () => {
    const preferences = await loadPluginDisplayPreferences(
      client({
        data: [
          {
            show_plugin_content: true,
            hidden_plugin_keys: ["a", " a ", "", 7, null, "b"],
          },
        ],
        error: null,
      }),
      "user-1",
    );
    expect(preferences.hiddenPluginKeys).toEqual(["a", "b"]);
  });

  test("an unreadable row hides content rather than undoing an opt-out", async () => {
    const warn = console.warn;
    console.warn = () => {};
    try {
      expect(
        await loadPluginDisplayPreferences(
          client({ data: null, error: { message: "boom" } }),
          "user-1",
        ),
      ).toEqual({ showPluginContent: false, hiddenPluginKeys: [] });
    } finally {
      console.warn = warn;
    }
  });

  test("an empty user id resolves to hidden without querying", async () => {
    expect(
      await loadPluginDisplayPreferences(
        {
          from: () => {
            throw new Error("should not query");
          },
        } as never,
        "",
      ),
    ).toEqual({ showPluginContent: false, hiddenPluginKeys: [] });
  });
});

describe("isPluginHidden", () => {
  test("the global switch outranks a per-plugin allow", () => {
    expect(
      isPluginHidden({ showPluginContent: false, hiddenPluginKeys: [] }, "a"),
    ).toBe(true);
  });

  test("an unlisted plugin is shown", () => {
    expect(
      isPluginHidden({ showPluginContent: true, hiddenPluginKeys: ["b"] }, "a"),
    ).toBe(false);
  });
});

describe("nextHiddenPluginKeys", () => {
  test("hiding adds the key, showing removes it", () => {
    expect(
      nextHiddenPluginKeys({
        current: [],
        pluginKey: "a",
        visible: false,
        reachableKeys: ["a", "b"],
      }),
    ).toEqual(["a"]);

    expect(
      nextHiddenPluginKeys({
        current: ["a", "b"],
        pluginKey: "a",
        visible: true,
        reachableKeys: ["a", "b"],
      }),
    ).toEqual(["b"]);
  });

  test("keys for plugins the person can no longer reach are pruned", () => {
    expect(
      nextHiddenPluginKeys({
        current: ["gone", "b"],
        pluginKey: "a",
        visible: false,
        reachableKeys: ["a", "b"],
      }),
    ).toEqual(["b", "a"]);
  });
});
