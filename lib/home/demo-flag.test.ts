import { describe, expect, test } from "bun:test";

import { HOME_DEMO_FLAG, isHomeDemoEnabled } from "./demo-flag";

const on = { [HOME_DEMO_FLAG]: "1" };

describe("isHomeDemoEnabled", () => {
  test("local development with the flag is enabled", () => {
    expect(isHomeDemoEnabled({ ...on, NODE_ENV: "development" })).toBe(true);
    expect(
      isHomeDemoEnabled({
        ...on,
        NODE_ENV: "development",
        VERCEL_ENV: "development",
      }),
    ).toBe(true);
  });

  test("a Vercel preview with the flag is enabled", () => {
    expect(
      isHomeDemoEnabled({
        ...on,
        NODE_ENV: "production",
        VERCEL_ENV: "preview",
      }),
    ).toBe(true);
  });

  test("the flag is off by default in every environment", () => {
    for (const environment of [
      {},
      { NODE_ENV: "development" },
      { NODE_ENV: "production", VERCEL_ENV: "preview" },
      { NODE_ENV: "production", VERCEL_ENV: "production" },
    ])
      expect(isHomeDemoEnabled(environment)).toBe(false);
  });

  test("only the exact value 1 turns the flag on", () => {
    for (const value of ["", "0", "true", "TRUE", "yes", "on", " 1", "01"])
      expect(
        isHomeDemoEnabled({
          [HOME_DEMO_FLAG]: value,
          NODE_ENV: "development",
        }),
      ).toBe(false);
  });

  test("production never enables the demo, whatever else is set", () => {
    for (const NODE_ENV of ["development", "production", "test", undefined])
      expect(
        isHomeDemoEnabled({ ...on, NODE_ENV, VERCEL_ENV: "production" }),
      ).toBe(false);
  });

  test("a standalone production build with no deployment context stays off", () => {
    expect(isHomeDemoEnabled({ ...on, NODE_ENV: "production" })).toBe(false);
    expect(isHomeDemoEnabled({ ...on })).toBe(false);
    expect(isHomeDemoEnabled({ ...on, NODE_ENV: "test" })).toBe(false);
  });

  test("a production build that claims a development Vercel context stays off", () => {
    expect(
      isHomeDemoEnabled({
        ...on,
        NODE_ENV: "production",
        VERCEL_ENV: "development",
      }),
    ).toBe(false);
  });

  test("an unrecognized or empty deployment context stays off", () => {
    for (const VERCEL_ENV of ["", "staging", "Production", "PREVIEW"])
      expect(
        isHomeDemoEnabled({ ...on, NODE_ENV: "development", VERCEL_ENV }),
      ).toBe(false);
  });

  test("the function reads only its argument", () => {
    const original = process.env[HOME_DEMO_FLAG];
    process.env[HOME_DEMO_FLAG] = "1";
    try {
      expect(isHomeDemoEnabled({ NODE_ENV: "development" })).toBe(false);
    } finally {
      if (original === undefined) delete process.env[HOME_DEMO_FLAG];
      else process.env[HOME_DEMO_FLAG] = original;
    }
  });
});
