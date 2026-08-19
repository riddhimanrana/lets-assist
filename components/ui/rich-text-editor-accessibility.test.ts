import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./rich-text-editor.tsx", import.meta.url),
  "utf8",
);

describe("shared rich text editor accessibility", () => {
  test("forwards accessible naming and description attributes to the editable surface", () => {
    expect(source).toContain('"aria-label"?: string');
    expect(source).toContain('"aria-labelledby"?: string');
    expect(source).toContain('"aria-describedby"?: string');
    expect(source).toContain('{ "aria-label": ariaLabel }');
    expect(source).toContain('{ "aria-labelledby": ariaLabelledBy }');
    expect(source).toContain('{ "aria-describedby": ariaDescribedBy }');
  });
});
