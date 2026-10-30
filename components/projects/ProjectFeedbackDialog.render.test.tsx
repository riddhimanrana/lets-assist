/**
 * Static render of the real feedback dialog and form. Base UI's Dialog only
 * renders its content when open, so a stand-in renders the trigger and the
 * content together. The feedback action is mocked and never runs.
 */
import { expect, mock, test } from "bun:test";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@/app/projects/[id]/actions", () => ({
  submitProjectFeedback: () => {
    throw new Error("Rendering must not submit");
  },
}));
const passthrough = ({ children }: { children?: ReactNode }) => (
  <div>{children}</div>
);
mock.module("@/components/ui/dialog", () => ({
  Dialog: passthrough,
  DialogTrigger: ({ render }: { render: ReactElement }) => render,
  DialogContent: passthrough,
  DialogHeader: passthrough,
  DialogTitle: passthrough,
  DialogDescription: ({ children }: { children?: ReactNode }) => (
    <p data-dialog-description>{children}</p>
  ),
}));

const { ProjectFeedbackDialog } = await import("./ProjectFeedbackDialog");
const { PROJECT_FEEDBACK_VISIBILITY } = await import("./feedback-visibility");

test("the dialog and its form both state the accurate visibility", () => {
  const html = renderToStaticMarkup(
    <ProjectFeedbackDialog
      projectId="00000000-0000-4000-8000-000000000001"
      signupId="00000000-0000-4000-8000-000000000002"
    />,
  ).replaceAll("&#x27;", "'");
  const description =
    /<p data-dialog-description="[^"]*">([\s\S]*?)<\/p>/u.exec(html)?.[1] ?? "";
  expect(description).toBe(PROJECT_FEEDBACK_VISIBILITY);
  // The form under it carries the same sentence, once.
  expect(html.split(PROJECT_FEEDBACK_VISIBILITY)).toHaveLength(3);
  expect(html).not.toContain("Only the organizer");
  expect(html).not.toContain("—");
});

test("the copy names private, not public, named, and every reader", () => {
  expect(PROJECT_FEEDBACK_VISIBILITY).toContain("private");
  expect(PROJECT_FEEDBACK_VISIBILITY).toContain(
    "never shown on the project page",
  );
  expect(PROJECT_FEEDBACK_VISIBILITY).toContain("Your name is shown");
  for (const reader of [
    "You",
    "the people who manage this project",
    "Let's Assist administrators",
  ]) {
    expect(PROJECT_FEEDBACK_VISIBILITY).toContain(reader);
  }
});
