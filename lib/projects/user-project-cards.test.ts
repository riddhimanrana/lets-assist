import { describe, expect, test } from "bun:test";
import {
  deduplicateVolunteerProjectCards,
  isHoursPublished,
} from "./user-project-cards";

test("hours badges require the exact schedule's own true publication flag", () => {
  expect(isHoursPublished({ oneTime: true }, "oneTime")).toBe(true);
  expect(isHoursPublished({ "Check-in desk": true }, "Check-in desk")).toBe(
    true,
  );
  for (const published of [
    undefined,
    null,
    true,
    false,
    [],
    {},
    { oneTime: false },
    { oneTime: "true" },
    { other: true },
  ]) {
    expect(isHoursPublished(published, "oneTime")).toBe(false);
  }
  for (const key of ["constructor", "__proto__", "toString", "oneTime"]) {
    expect(isHoursPublished(Object.create({ oneTime: true }), key)).toBe(false);
  }
  for (const schedule of [
    null,
    undefined,
    0,
    "",
    " ",
    " oneTime",
    "oneTime ",
  ]) {
    expect(isHoursPublished({ oneTime: true }, schedule)).toBe(false);
  }
});

describe("deduplicateVolunteerProjectCards", () => {
  test("renders one card for multiple active schedule signups", () => {
    const cards = deduplicateVolunteerProjectCards([
      {
        id: "project-1",
        signupId: "latest-signup",
        areHoursPublished: false,
      },
      {
        id: "project-1",
        signupId: "earlier-signup",
        areHoursPublished: true,
      },
      {
        id: "project-2",
        signupId: "other-project-signup",
        areHoursPublished: false,
      },
    ]);

    expect(cards).toEqual([
      {
        id: "project-1",
        signupId: "latest-signup",
        areHoursPublished: true,
      },
      {
        id: "project-2",
        signupId: "other-project-signup",
        areHoursPublished: false,
      },
    ]);
  });
});
