import { describe, expect, test } from "bun:test";

import {
  MAX_WAIVER_DEFINITION_SIGNERS,
  describeMissingSignatureFields,
  findRequiredSignersMissingSignatureField,
  waiverDefinitionInputSchema,
} from "./definition-input";

function validDefinition() {
  return {
    signers: [
      {
        roleKey: "participant",
        label: "Participant",
        required: true,
        orderIndex: 0,
      },
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
    expect(
      waiverDefinitionInputSchema.safeParse(validDefinition()).success,
    ).toBe(true);
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
    expect(
      waiverDefinitionInputSchema.safeParse(definitionWithSpaces).success,
    ).toBe(true);
  });

  test("rejects duplicate signer roles", () => {
    const definition = validDefinition();
    definition.signers.push({
      roleKey: "participant",
      label: "Duplicate",
      required: true,
      orderIndex: 1,
    });
    expect(waiverDefinitionInputSchema.safeParse(definition).success).toBe(
      false,
    );
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
    expect(waiverDefinitionInputSchema.safeParse(definition).success).toBe(
      false,
    );
  });

  test("rejects negative or non-finite field geometry", () => {
    const negative = validDefinition();
    negative.fields.detected.signature.rect.x = -1;
    expect(waiverDefinitionInputSchema.safeParse(negative).success).toBe(false);

    const nonFinite = validDefinition();
    nonFinite.fields.detected.signature.rect.width = Number.POSITIVE_INFINITY;
    expect(waiverDefinitionInputSchema.safeParse(nonFinite).success).toBe(
      false,
    );
  });

  test("rejects unknown field enums and signer references", () => {
    const unknownType = validDefinition() as ReturnType<
      typeof validDefinition
    > & {
      fields: { detected: { signature: { fieldType: string } } };
    };
    unknownType.fields.detected.signature.fieldType = "script";
    expect(waiverDefinitionInputSchema.safeParse(unknownType).success).toBe(
      false,
    );

    const unknownSigner = validDefinition();
    unknownSigner.fields.detected.signature.signerRoleKey = "missing";
    expect(waiverDefinitionInputSchema.safeParse(unknownSigner).success).toBe(
      false,
    );
  });
});

describe("waiverDefinitionInputSchema signature coverage", () => {
  const guardian = (required: boolean) => ({
    roleKey: "guardian",
    label: "Parent/Guardian",
    required,
    orderIndex: 1,
  });
  const customField = (fieldType: string, signerRoleKey: string) => ({
    id: `custom_${fieldType}_${signerRoleKey}`,
    label: "Placed field",
    signerRoleKey,
    fieldType,
    required: true,
    pageIndex: 0,
    rect: { x: 10, y: 120, width: 180, height: 50 },
  });
  const issues = (definition: unknown) => {
    const result = waiverDefinitionInputSchema.safeParse(definition);
    return result.success
      ? []
      : result.error.issues.map((issue) => issue.message);
  };

  test("rejects a required signer with no signature field", () => {
    const definition = validDefinition();
    definition.signers.push(guardian(true));

    expect(issues(definition)).toEqual([
      'Required signer "Parent/Guardian" needs a signature field',
    ]);
  });

  test("accepts an optional signer with no signature field", () => {
    const definition = validDefinition();
    definition.signers.push(guardian(false));

    expect(issues(definition)).toEqual([]);
  });

  test("accepts a required signer covered by a placed signature field", () => {
    const definition = {
      ...validDefinition(),
      signers: [...validDefinition().signers, guardian(true)],
      fields: {
        detected: validDefinition().fields.detected,
        custom: [customField("signature", "guardian")],
      },
    };

    expect(issues(definition)).toEqual([]);
  });

  test("an initials field does not count as a signature", () => {
    const definition = {
      ...validDefinition(),
      signers: [...validDefinition().signers, guardian(true)],
      fields: {
        detected: validDefinition().fields.detected,
        custom: [customField("initial", "guardian")],
      },
    };

    expect(issues(definition)).toEqual([
      'Required signer "Parent/Guardian" needs a signature field',
    ]);
  });

  test("a text placement does not count as a signature", () => {
    const definition = {
      signers: validDefinition().signers,
      fields: { detected: {}, custom: [customField("text", "participant")] },
    };

    expect(issues(definition)).toEqual([
      'Required signer "Participant" needs a signature field',
    ]);
  });

  test("an unassigned detected signature field does not count", () => {
    const definition = validDefinition() as {
      signers: ReturnType<typeof validDefinition>["signers"];
      fields: {
        detected: { signature: { signerRoleKey?: string } };
        custom: never[];
      };
    };
    delete definition.fields.detected.signature.signerRoleKey;

    expect(issues(definition)).toEqual([
      'Required signer "Participant" needs a signature field',
    ]);
  });

  test("names every signer the builder still has to cover", () => {
    const missing = findRequiredSignersMissingSignatureField({
      signers: [
        { roleKey: "a", label: "Volunteer", required: true },
        { roleKey: "b", label: "Parent/Guardian", required: true },
        { roleKey: "c", label: "Witness", required: true },
        { roleKey: "d", label: "Coach", required: false },
      ],
      fields: {
        detected: {},
        custom: [{ fieldType: "signature", signerRoleKey: "c" }],
      },
    });

    expect(missing.map((signer) => signer.roleKey)).toEqual(["a", "b"]);
    expect(describeMissingSignatureFields(missing)).toBe(
      "Add a signature field for Volunteer and Parent/Guardian before saving. An initials field does not count.",
    );
    expect(describeMissingSignatureFields([])).toBeNull();
  });
});
