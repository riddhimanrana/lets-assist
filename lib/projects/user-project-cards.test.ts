import { describe, expect, test } from "bun:test";
import { deduplicateVolunteerProjectCards } from "./user-project-cards";

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
