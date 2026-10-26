import { expect, test } from "bun:test";
import { nextCustomFieldDefaults } from "./definition-mappings";
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
