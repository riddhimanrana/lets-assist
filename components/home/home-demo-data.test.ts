import { describe, expect, test } from "bun:test";

import {
  HOME_DEMO_COUNTERS,
  HOME_DEMO_MAX_TICK,
  HOME_DEMO_NO_SIGNUP_TEXT,
  HOME_DEMO_NOTICE,
  HOME_DEMO_PROJECTS,
  HOME_DEMO_SAMPLE_PROFILE,
  HOME_DEMO_TICK_MS,
  demoCounterDelta,
  demoCounterValue,
  formatDemoCount,
  shouldRunDemoCounters,
} from "./home-demo-data";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu;

describe("sample counters", () => {
  test("start at the requested sample values", () => {
    expect(
      HOME_DEMO_COUNTERS.map((counter) => [
        counter.id,
        demoCounterValue(counter, 0),
      ]),
    ).toEqual([
      ["demo-counter-volunteers", 5000],
      ["demo-counter-us-projects", 492],
    ]);
    expect(formatDemoCount(5000)).toBe("5,000");
    expect(formatDemoCount(492)).toBe("492");
  });

  test("every counter says it is a sample in its visible label and helper", () => {
    for (const counter of HOME_DEMO_COUNTERS) {
      expect(counter.label).toMatch(/^Sample /u);
      expect(counter.helper).toMatch(/made-up/iu);
    }
  });

  test("the same tick always gives the same value", () => {
    for (const counter of HOME_DEMO_COUNTERS)
      for (const tick of [0, 1, 7, 8, 9, 100])
        expect(demoCounterValue(counter, tick)).toBe(
          demoCounterValue(counter, tick),
        );
    expect(demoCounterDelta([2, 0, 1], 1)).toBe(2);
    expect(demoCounterDelta([2, 0, 1], 2)).toBe(2);
    expect(demoCounterDelta([2, 0, 1], 3)).toBe(3);
    expect(demoCounterDelta([2, 0, 1], 7)).toBe(8);
  });

  test("values change over time and never decrease", () => {
    for (const counter of HOME_DEMO_COUNTERS) {
      let previous = demoCounterValue(counter, 0);
      for (let tick = 1; tick <= HOME_DEMO_MAX_TICK; tick += 1) {
        const value = demoCounterValue(counter, tick);
        expect(value).toBeGreaterThanOrEqual(previous);
        expect(value - previous).toBeLessThanOrEqual(3);
        previous = value;
      }
      expect(previous).toBeGreaterThan(counter.start);
    }
  });

  test("growth stops at the tick cap", () => {
    for (const counter of HOME_DEMO_COUNTERS) {
      const capped = demoCounterValue(counter, HOME_DEMO_MAX_TICK);
      expect(demoCounterValue(counter, HOME_DEMO_MAX_TICK + 1)).toBe(capped);
      expect(demoCounterValue(counter, Number.MAX_SAFE_INTEGER)).toBe(capped);
      expect(demoCounterValue(counter, Number.POSITIVE_INFINITY)).toBe(
        counter.start,
      );
      expect(capped).toBeLessThan(counter.start * 2);
    }
  });

  test("unsafe ticks and steps fall back to no change", () => {
    const volunteers = HOME_DEMO_COUNTERS[0];
    if (!volunteers) throw new Error("The volunteer counter is missing");
    for (const tick of [-1, -0.5, Number.NaN, Number.NEGATIVE_INFINITY])
      expect(demoCounterValue(volunteers, tick)).toBe(volunteers.start);
    expect(demoCounterValue(volunteers, 1.9)).toBe(
      demoCounterValue(volunteers, 1),
    );
    expect(demoCounterDelta([], 5)).toBe(0);
    expect(demoCounterDelta([-4, Number.NaN, 1.8], 3)).toBe(1);
  });

  test("the cadence is slow enough to read", () => {
    expect(HOME_DEMO_TICK_MS).toBeGreaterThanOrEqual(3000);
  });

  test("counters stand still when hidden or under reduced motion", () => {
    expect(shouldRunDemoCounters({ hidden: false, reducedMotion: false })).toBe(
      true,
    );
    expect(shouldRunDemoCounters({ hidden: true, reducedMotion: false })).toBe(
      false,
    );
    expect(shouldRunDemoCounters({ hidden: false, reducedMotion: true })).toBe(
      false,
    );
    expect(shouldRunDemoCounters({ hidden: true, reducedMotion: true })).toBe(
      false,
    );
  });
});

describe("sample projects", () => {
  test("there are six, each in a different US city", () => {
    expect(HOME_DEMO_PROJECTS).toHaveLength(6);
    expect(new Set(HOME_DEMO_PROJECTS.map(({ city }) => city)).size).toBe(6);
    expect(new Set(HOME_DEMO_PROJECTS.map(({ icon }) => icon)).size).toBe(6);
    expect(HOME_DEMO_PROJECTS.map(({ city }) => city)).toEqual(
      expect.arrayContaining(["Austin", "Portland", "Madison"]),
    );
  });

  test("identifiers are stable, unique, demo-only, and never UUIDs", () => {
    const ids = HOME_DEMO_PROJECTS.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^demo-project-[a-z-]+$/u);
      expect(id).not.toMatch(UUID);
    }
    expect(ids[0]).toBe("demo-project-austin-creek");
  });

  test("every project has a role, a time, and things to do", () => {
    for (const project of HOME_DEMO_PROJECTS) {
      expect(project.role.length).toBeGreaterThan(3);
      expect(project.schedule).toMatch(/\d/u);
      expect(project.summary.length).toBeGreaterThan(30);
      expect(project.tasks.length).toBeGreaterThanOrEqual(3);
      expect(project.organizer).toMatch(/^Example /u);
    }
  });

  test("the data carries no links, emails, images, or real record fields", () => {
    const serialized = JSON.stringify({
      HOME_DEMO_PROJECTS,
      HOME_DEMO_COUNTERS,
      HOME_DEMO_SAMPLE_PROFILE,
    });
    expect(serialized).not.toMatch(/https?:|www\.|\/projects\/|\/signup/iu);
    expect(serialized).not.toContain("@");
    expect(serialized).not.toMatch(/\.(?:png|jpe?g|webp|gif|svg)/iu);
    expect(serialized).not.toMatch(UUID);
    for (const project of HOME_DEMO_PROJECTS)
      for (const field of [
        "creator_id",
        "organization_id",
        "visibility",
        "workflow_status",
        "cover_image_url",
      ])
        expect(project).not.toHaveProperty(field);
  });
});

describe("demo wording", () => {
  test("the notice says the numbers and projects are fictional", () => {
    expect(HOME_DEMO_NOTICE.title).toMatch(/demo/iu);
    expect(HOME_DEMO_NOTICE.description).toMatch(/numbers and projects/iu);
    expect(HOME_DEMO_NOTICE.description).toMatch(/fictional/iu);
  });

  test("the no-signup line is exact", () => {
    expect(HOME_DEMO_NO_SIGNUP_TEXT).toBe(
      "This example does not accept signups.",
    );
  });

  test("the sample profile is labelled as one", () => {
    expect(HOME_DEMO_SAMPLE_PROFILE.label).toBe("Sample profile");
    expect(HOME_DEMO_SAMPLE_PROFILE.name).toMatch(/Example$/u);
  });
});
