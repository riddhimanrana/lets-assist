import { describe, expect, test } from "bun:test";

import type { WaiverDefinitionSigner } from "@/types/waiver-definitions";
import {
  isSkippableStep,
  stepIndexAfterSkippingSigner,
  withoutSkippedSignerValues,
} from "./skip-optional-signer";
import type { WaiverSigningStep } from "./types";

const signer = (
  role_key: string,
  required: boolean,
): WaiverDefinitionSigner => ({
  role_key,
  label: role_key,
  required,
  order_index: 0,
  rules: null,
});

const volunteer = signer("volunteer", true);
const guardian = signer("guardian", false);
const witness = signer("witness", true);

const step = (
  type: WaiverSigningStep["type"],
  owner?: WaiverDefinitionSigner,
): WaiverSigningStep => ({
  id: `${type}-${owner?.role_key ?? "all"}`,
  type,
  title: type,
  signer: owner,
});

describe("isSkippableStep", () => {
  test("an optional signer's details and signature steps can both be skipped", () => {
    expect(isSkippableStep(step("fields", guardian))).toBe(true);
    expect(isSkippableStep(step("sign", guardian))).toBe(true);
  });

  test("a required signer's steps, shared steps, and review cannot", () => {
    expect(isSkippableStep(step("fields", volunteer))).toBe(false);
    expect(isSkippableStep(step("sign", volunteer))).toBe(false);
    expect(isSkippableStep(step("fields"))).toBe(false);
    expect(isSkippableStep(step("review"))).toBe(false);
    expect(isSkippableStep(undefined)).toBe(false);
  });
});

describe("stepIndexAfterSkippingSigner", () => {
  const steps = [
    step("review"),
    step("fields", volunteer),
    step("sign", volunteer),
    step("fields", guardian),
    step("sign", guardian),
    step("sign", witness),
  ];

  test("skipping from the details step jumps past the signature step too", () => {
    expect(stepIndexAfterSkippingSigner(steps, 3)).toBe(5);
  });

  test("skipping from the signature step moves to the next signer", () => {
    expect(stepIndexAfterSkippingSigner(steps, 4)).toBe(5);
  });

  test("skipping the last signer finishes the waiver", () => {
    const ending = steps.slice(0, 5);
    expect(stepIndexAfterSkippingSigner(ending, 3)).toBeNull();
    expect(stepIndexAfterSkippingSigner(ending, 4)).toBeNull();
  });

  test("a step with no signer has nothing to skip", () => {
    expect(stepIndexAfterSkippingSigner(steps, 0)).toBeNull();
  });
});

describe("withoutSkippedSignerValues", () => {
  const fields = [
    { field_key: "volunteer_name", signer_role_key: "volunteer" },
    { field_key: "guardian_name", signer_role_key: "guardian" },
    { field_key: "emergency_phone", signer_role_key: null },
  ];
  const values = {
    volunteer_name: "Alex Johnson",
    guardian_name: "Sa",
    emergency_phone: "555-0100",
  };

  test("drops only the skipped signer's values", () => {
    expect(
      withoutSkippedSignerValues(values, fields, new Set(["guardian"])),
    ).toEqual({
      volunteer_name: "Alex Johnson",
      emergency_phone: "555-0100",
    });
  });

  test("leaves everything alone when nobody was skipped", () => {
    expect(withoutSkippedSignerValues(values, fields, new Set())).toBe(values);
  });
});
