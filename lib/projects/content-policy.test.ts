import { expect, test } from "bun:test";
import { projectContentIssue } from "./content-policy";

test("create and edit share field-specific checks, including rich text", async () => {
  for (const field of ["title", "location", "description"] as const) {
    const issue = await projectContentIssue({
      [field]: field === "description" ? "<p>shit</p>" : "shit",
    });
    expect(issue).toContain(field);
    expect(issue).toContain("shit");
  }
  expect(
    await projectContentIssue({
      title: "Community cleanup",
      location: "Lahore, Pakistan",
      description: "<p>Clean the local park.</p>",
    }),
  ).toBeNull();
  expect(await projectContentIssue({})).toBeNull();
});
