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

test("description checks count visible text after decoding sanitized entities", async () => {
  for (const entity of ["&amp;", "&lt;", "&gt;", "&#38;", "&#x26;"]) {
    expect(
      await projectContentIssue({
        description: `<p>${"a".repeat(1900)}${entity.repeat(100)}</p>`,
      }),
    ).toBeNull();
  }
  await expect(
    projectContentIssue({ description: `<p>${"&amp;".repeat(2001)}</p>` }),
  ).rejects.toThrow("Content is not valid");
});

test("decoding keeps encoded visible language subject to moderation", async () => {
  for (const description of ["<p>&lt;shit&gt;</p>", "<p>&#115;hit</p>"]) {
    expect(await projectContentIssue({ description })).toContain("shit");
  }
});
