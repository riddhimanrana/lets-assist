import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function readComponent(fileName: string) {
  return readFileSync(new URL(`./${fileName}`, import.meta.url), "utf8");
}

const datePickerSource = readComponent("date-picker.tsx");
const dateTimePickerSource = readComponent("date-time-picker.tsx");

describe("shared date picker accessibility", () => {
  test("threads field names and validation state to each trigger", () => {
    for (const source of [datePickerSource, dateTimePickerSource]) {
      expect(source).toContain("id={id}");
      expect(source).toContain("aria-describedby={ariaDescribedBy}");
      expect(source).toContain("aria-label={ariaLabel}");
      expect(source).toContain("aria-required={required}");
      expect(source).toContain("aria-invalid={error || undefined}");
    }
  });

  test("never submits a surrounding form from a picker action", () => {
    const buttonCount = (datePickerSource + dateTimePickerSource).match(
      /<Button/g,
    )?.length;
    const nonSubmitCount = (datePickerSource + dateTimePickerSource).match(
      /type="button"/g,
    )?.length;

    expect(buttonCount).toBe(nonSubmitCount);
  });
});
