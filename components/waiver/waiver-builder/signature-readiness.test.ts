import { expect, test } from "bun:test";
import {
  nextCustomFieldDefaults,
  buildDefinitionPayload,
} from "./definition-mappings";
import type { WaiverDefinitionInput } from "./types";
import { waiverDefinitionInputSchema } from "@/lib/waiver/definition-input";
import { getWaiverStepError } from "@/app/projects/create/create-blockers";
import { createInitialEventFormState } from "@/hooks/use-event-form";

function draft(): WaiverDefinitionInput {
  return {
    signers: [
      {
        roleKey: "volunteer",
        label: "Volunteer",
        required: true,
        orderIndex: 0,
      },
      { roleKey: "guardian", label: "Guardian", required: true, orderIndex: 1 },
    ],
    fields: { detected: {}, custom: [] },
  };
}

test("an incomplete two-signer draft becomes ready only after both signature positions are chosen", () => {
  const definition = draft();
  const state = {
    ...createInitialEventFormState(),
    waiverRequired: true,
    waiverPdfUrl: "/synthetic.pdf",
    waiverDefinition: definition,
  };
  expect(getWaiverStepError(state)).not.toBeNull();
  for (const [index, role] of ["volunteer", "guardian"].entries()) {
    const defaults = nextCustomFieldDefaults(definition);
    expect(defaults).toMatchObject({
      signerRoleKey: role,
      fieldType: "signature",
      required: true,
    });
    definition.fields.custom.push({
      id: `signature-${index}`,
      ...defaults,
      pageIndex: 0,
      rect: { x: 10, y: 20 + index * 60, width: 180, height: 50 },
    });
    expect(waiverDefinitionInputSchema.safeParse(definition).success).toBe(
      index === 1,
    );
  }
  expect(getWaiverStepError(state)).toBeNull();
  expect(nextCustomFieldDefaults(definition)).toMatchObject({
    fieldType: "text",
    required: false,
  });
});

test("initials and unassigned signatures never satisfy a required role", () => {
  const definition = draft();
  definition.fields.custom.push({
    id: "initials",
    label: "Initials",
    signerRoleKey: "volunteer",
    fieldType: "initial",
    required: true,
    pageIndex: 0,
    rect: { x: 10, y: 20, width: 60, height: 30 },
  });
  expect(nextCustomFieldDefaults(definition).signerRoleKey).toBe("volunteer");
  expect(waiverDefinitionInputSchema.safeParse(definition).success).toBe(false);
});

test("AI role diagnostics do not poison a saved seven-placement waiver", () => {
  const roles = [
    {
      roleKey: "volunteer",
      label: "Volunteer",
      required: true,
      orderIndex: 0,
      description: "Adult or minor volunteer",
    },
    {
      roleKey: "parent_guardian",
      label: "Parent/Guardian",
      required: false,
      orderIndex: 1,
      description: "Only for minors",
    },
  ];
  const placements = Array.from({ length: 7 }, (_, index) => ({
    id: `ai-${index}`,
    fieldKey: `ai-${index}`,
    label: `Field ${index}`,
    signerRoleKey: index === 6 ? "parent_guardian" : "volunteer",
    fieldType:
      index === 0 || index === 6 ? ("signature" as const) : ("name" as const),
    required: true,
    pageIndex: 0,
    rect: { x: 10, y: 20 + index * 60, width: 180, height: 50 },
    meta: { helpText: "", signingPurpose: "" },
  }));
  expect(
    waiverDefinitionInputSchema.safeParse({
      signers: roles,
      fields: { detected: {}, custom: placements },
    }).success,
  ).toBe(false);
  const saved = buildDefinitionPayload(roles, {}, placements, []);
  expect(saved.signers[0]).not.toHaveProperty("description");
  expect(saved.fields.custom).toEqual(placements);
  expect(saved.signers.map((role) => role.required)).toEqual([true, false]);
  expect(waiverDefinitionInputSchema.safeParse(saved).success).toBe(true);
  expect(
    getWaiverStepError({
      ...createInitialEventFormState(),
      waiverRequired: true,
      waiverPdfUrl: "/synthetic.pdf",
      waiverDefinition: saved,
    }),
  ).toBeNull();
  const withoutSignature = {
    ...saved,
    fields: {
      detected: {},
      custom: placements.filter((field) => field.fieldType !== "signature"),
    },
  };
  expect(
    getWaiverStepError({
      ...createInitialEventFormState(),
      waiverRequired: true,
      waiverPdfUrl: "/synthetic.pdf",
      waiverDefinition: withoutSignature,
    }),
  ).not.toBeNull();
});
