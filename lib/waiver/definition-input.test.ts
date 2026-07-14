import { describe, expect, test } from "bun:test";

import {
  MAX_WAIVER_DEFINITION_SIGNERS,
  waiverDefinitionInputSchema,
} from "./definition-input";

function validDefinition() {
  return {
    signers: [
      { roleKey: "participant", label: "Participant", required: true, orderIndex: 0 },
    ],
    fields: {
      detected: {
        signature: {
          fieldKey: "signature",
          fieldType: "signature",
          pageIndex: 0,
          rect: { x: 10, y: 20, width: 180, height: 50 },
          required: true,
          signerRoleKey: "participant",
        },
      },
      custom: [],
    },
  };
}

describe("waiverDefinitionInputSchema", () => {
  test("accepts a bounded definition", () => {
    expect(waiverDefinitionInputSchema.safeParse(validDefinition()).success).toBe(true);
  });

  test("accepts printable PDF field names with spaces", () => {
    const definition = validDefinition();
    const definitionWithSpaces = {
      ...definition,
      fields: {
        ...definition.fields,
        detected: {
          "Participant Signature": {
            ...definition.fields.detected.signature,
            fieldKey: "Participant Signature",
          },
        },
      },
    };
    expect(waiverDefinitionInputSchema.safeParse(definitionWithSpaces).success).toBe(true);
  });

  test("rejects duplicate signer roles", () => {
    const definition = validDefinition();
    definition.signers.push({
      roleKey: "participant",
      label: "Duplicate",
      required: true,
      orderIndex: 1,
    });
    expect(waiverDefinitionInputSchema.safeParse(definition).success).toBe(false);
  });

  test("rejects excessive signer counts", () => {
    const definition = validDefinition();
    definition.signers = Array.from(
      { length: MAX_WAIVER_DEFINITION_SIGNERS + 1 },
      (_, index) => ({
        roleKey: `signer_${index}`,
        label: `Signer ${index}`,
        required: true,
        orderIndex: index,
      }),
    );
    expect(waiverDefinitionInputSchema.safeParse(definition).success).toBe(false);
  });

  test("rejects negative or non-finite field geometry", () => {
    const negative = validDefinition();
    negative.fields.detected.signature.rect.x = -1;
    expect(waiverDefinitionInputSchema.safeParse(negative).success).toBe(false);

    const nonFinite = validDefinition();
    nonFinite.fields.detected.signature.rect.width = Number.POSITIVE_INFINITY;
    expect(waiverDefinitionInputSchema.safeParse(nonFinite).success).toBe(false);
  });

  test("rejects unknown field enums and signer references", () => {
    const unknownType = validDefinition() as ReturnType<typeof validDefinition> & {
      fields: { detected: { signature: { fieldType: string } } };
    };
    unknownType.fields.detected.signature.fieldType = "script";
    expect(waiverDefinitionInputSchema.safeParse(unknownType).success).toBe(false);

    const unknownSigner = validDefinition();
    unknownSigner.fields.detected.signature.signerRoleKey = "missing";
    expect(waiverDefinitionInputSchema.safeParse(unknownSigner).success).toBe(false);
  });
});
