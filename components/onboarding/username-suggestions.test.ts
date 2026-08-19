import { describe, expect, test } from "bun:test";

import {
  firstAvailableUsername,
  usernameCandidatesFromIdentity,
} from "./username-suggestions";

/**
 * The onboarding modal opened with an empty username box and told students it
 * "will keep showing up until filled out". Suggesting a handle from the name
 * they already gave removes that stall. Suggestions are never authoritative --
 * availability decides, and the student can always type their own.
 */

describe("usernameCandidatesFromIdentity", () => {
  test("offers the natural handles first, most-natural first", () => {
    const candidates = usernameCandidatesFromIdentity(
      "Nina Kapoor",
      "nina.kapoor28@students.local.test",
    );
    expect(candidates.slice(0, 4)).toEqual([
      "nina-kapoor",
      "ninakapoor",
      "nina-k",
      "nina",
    ]);
  });

  test("is deterministic, so a reload offers the same name", () => {
    const first = usernameCandidatesFromIdentity("Nina Kapoor", null);
    const second = usernameCandidatesFromIdentity("Nina Kapoor", null);
    expect(first).toEqual(second);
  });

  test("strips accents rather than dropping the letters", () => {
    const candidates = usernameCandidatesFromIdentity("Sofía Nguyễn", null);
    expect(candidates[0]).toBe("sofia-nguyen");
    for (const candidate of candidates) {
      expect(candidate).toMatch(/^[a-z0-9_.-]+$/u);
    }
  });

  test("handles a middle name by pairing first with last", () => {
    const candidates = usernameCandidatesFromIdentity("Maya P Patel", null);
    expect(candidates[0]).toBe("maya-patel");
  });

  test("falls back to the email local part when there is no name", () => {
    const candidates = usernameCandidatesFromIdentity(
      null,
      "nina.kapoor28@students.local.test",
    );
    expect(candidates).toContain("nina-kapoor28");
  });

  test("offers numbered alternates for the common collision", () => {
    const candidates = usernameCandidatesFromIdentity("Nina Kapoor", null);
    expect(candidates).toContain("nina-kapoor2");
    expect(candidates).toContain("ninakapoor2");
  });

  test("never emits something the username rule would reject", () => {
    for (const name of ["Nina Kapoor", "  ", "!!!", "A", "Sofía Nguyễn"]) {
      for (const candidate of usernameCandidatesFromIdentity(name, null)) {
        expect(candidate.length).toBeGreaterThanOrEqual(3);
        expect(candidate.length).toBeLessThanOrEqual(32);
        expect(candidate).toMatch(/^[a-z0-9_.-]+$/u);
        expect(candidate.endsWith("-")).toBe(false);
      }
    }
  });

  test("produces nothing usable from empty identity rather than junk", () => {
    expect(usernameCandidatesFromIdentity(null, null)).toEqual([]);
    expect(usernameCandidatesFromIdentity("", "")).toEqual([]);
    // A single letter cannot reach the three-character minimum.
    expect(usernameCandidatesFromIdentity("A", null)).toEqual([]);
  });

  test("clamps a very long name without a trailing separator", () => {
    const candidates = usernameCandidatesFromIdentity(
      `${"Alexandria".repeat(3)} ${"Montgomery".repeat(3)}`,
      null,
    );
    for (const candidate of candidates) {
      expect(candidate.length).toBeLessThanOrEqual(32);
      expect(candidate.endsWith("-")).toBe(false);
    }
  });
});

describe("firstAvailableUsername", () => {
  test("returns the first candidate that is actually free", async () => {
    const taken = new Set(["nina-kapoor", "ninakapoor"]);
    const picked = await firstAvailableUsername(
      ["nina-kapoor", "ninakapoor", "nina-k"],
      async (candidate) => !taken.has(candidate),
    );
    expect(picked).toBe("nina-k");
  });

  test("returns null when everything is taken, never a taken handle", async () => {
    const picked = await firstAvailableUsername(
      ["a-b", "c-d"],
      async () => false,
    );
    expect(picked).toBeNull();
  });

  test("treats a failing check as do-not-suggest", async () => {
    const picked = await firstAvailableUsername(["nina-kapoor"], async () => {
      throw new Error("network down");
    });
    expect(picked).toBeNull();
  });

  test("stops checking once it finds one", async () => {
    const checked: string[] = [];
    await firstAvailableUsername(["a-b", "c-d", "e-f"], async (candidate) => {
      checked.push(candidate);
      return candidate === "c-d";
    });
    expect(checked).toEqual(["a-b", "c-d"]);
  });
});
