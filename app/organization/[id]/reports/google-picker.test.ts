import { describe, expect, test } from "bun:test";

import { buildReportsGoogleSheetPicker } from "./google-picker";

describe("organization report Google Picker", () => {
  test("sets the app ID and exact page origin before build", () => {
    const calls: string[] = [];
    const chain = {
      setTitle: () => (calls.push("title"), chain),
      addView: () => (calls.push("view"), chain),
      setOAuthToken: () => (calls.push("oauth"), chain),
      setDeveloperKey: () => (calls.push("developerKey"), chain),
      setAppId: (appId: string) => (calls.push(`appId:${appId}`), chain),
      setOrigin: (origin: string) => (calls.push(`origin:${origin}`), chain),
      setCallback: () => (calls.push("callback"), chain),
      build: () => {
        calls.push("build");
        return { setVisible: () => undefined };
      },
    };

    buildReportsGoogleSheetPicker({
      builder: chain,
      title: "Select a Google Sheet",
      view: { setMimeTypes: () => undefined },
      accessToken: "fixture-access-token",
      developerKey: "fixture-developer-key",
      pickerAppId: "123456789012",
      callback: () => undefined,
      browserWindow: {
        location: {
          origin: "https://development.example",
          href: "https://development.example/organization/example?tab=reports",
        },
      },
    });

    expect(calls).toEqual([
      "title",
      "view",
      "oauth",
      "developerKey",
      "appId:123456789012",
      "origin:https://development.example",
      "callback",
      "build",
    ]);
  });
});
