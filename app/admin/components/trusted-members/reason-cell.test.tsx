import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { TrustedMemberReasonCell } from "./reason-cell";

const name = "Demo Applicant";
const email = "applicant@example.test";

function renderReason(reason: string) {
  return renderToStaticMarkup(
    <TrustedMemberReasonCell reason={reason} name={name} email={email} />,
  );
}

test("offers the full reason even below the former truncation threshold", () => {
  const reason =
    "I would like to create a volunteer project for our school club.";
  expect(reason.length).toBeLessThan(80);
  const html = renderReason(reason);
  expect(html).toContain(reason);
  expect(html).toContain('aria-label="View full reason for Demo Applicant"');
  expect(html).toContain('type="button"');
  expect(html).toContain(">View full reason</button>");
});

test("keeps the full-reason control for short and multiline messages", () => {
  for (const reason of ["Volunteering", "First line\nSecond line"]) {
    expect(renderReason(reason)).toContain(">View full reason</button>");
  }
});

test("omits the control for a blank reason", () => {
  const html = renderReason(" \n\t");
  expect(html).toContain("No reason provided");
  expect(html).not.toContain("<button");
});
