import { expect, mock, test } from "bun:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const Wrapper = ({ children }: { children?: ReactNode }) =>
  createElement("div", null, children);
mock.module("@/components/ui/dialog", () => ({
  Dialog: Wrapper,
  DialogContent: Wrapper,
  DialogDescription: Wrapper,
  DialogFooter: Wrapper,
  DialogHeader: Wrapper,
  DialogTitle: Wrapper,
}));

const { ProjectEmailConfirmationDialog } =
  await import("./ProjectEmailConfirmationDialog");

function render(confirmationEmailAccepted: boolean) {
  return renderToStaticMarkup(
    <ProjectEmailConfirmationDialog
      open
      confirmationEmailAccepted={confirmationEmailAccepted}
      onOpenChange={() => {}}
      onCopyLink={() => {}}
    />,
  );
}

test("an accepted confirmation email explains how to finish signup", () => {
  const html = render(true);
  expect(html).toContain("Check your email");
  expect(html).toContain("A confirmation email has been sent.");
  expect(html).not.toContain("email delivery could not be confirmed");
});

test("an unknown delivery outcome preserves signup without claiming email was sent", () => {
  const html = render(false);
  expect(html).toContain("Confirm your signup");
  expect(html).toContain("Your signup is saved");
  expect(html).toContain("email delivery could not be confirmed");
  expect(html).toContain("request a new confirmation link");
  expect(html).not.toContain("email has been sent");
});
