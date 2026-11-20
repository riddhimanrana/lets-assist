import { expect, test } from "bun:test";
import { parsePublicSignUpGenius } from "./signupgenius-parser";

test("unverified markup never becomes a successful import or participant preview", () => {
  const html =
    "<html><h1>Fictional cleanup</h1><table><tr><td>Setup</td><td>Synthetic Participant</td><td>synthetic@example.test</td></tr></table><p>Training on 2025-10-11; event date unspecified.</p></html>";
  expect(() =>
    parsePublicSignUpGenius(
      html,
      "https://www.signupgenius.com/go/10C0B4CAEAD2EA6FEC34",
    ),
  ).toThrow("unsupported");
});
