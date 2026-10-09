import { describe, expect, test } from "bun:test";

import type { SignaturePayload } from "@/types/waiver-definitions";
import { validateWaiverPayload } from "./validate-waiver-payload";

const definition = (guardianRequired: boolean) => ({
  id: "definition",
  signers: [
    { role_key: "volunteer", label: "Volunteer", required: true },
    {
      role_key: "guardian",
      label: "Parent/Guardian",
      required: guardianRequired,
    },
  ],
  fields: [
    {
      field_key: "volunteer_signature",
      field_type: "signature",
      label: "Volunteer signature",
      required: true,
      signer_role_key: "volunteer",
    },
    {
      field_key: "volunteer_name",
      field_type: "name",
      label: "Volunteer name",
      required: true,
      signer_role_key: "volunteer",
    },
    {
      field_key: "guardian_signature",
      field_type: "signature",
      label: "Parent signature",
      required: true,
      signer_role_key: "guardian",
    },
    {
      field_key: "guardian_name",
      field_type: "name",
      label: "Parent name",
      required: true,
      signer_role_key: "guardian",
    },
    {
      field_key: "emergency_phone",
      field_type: "phone",
      label: "Emergency phone",
      required: true,
      signer_role_key: null,
    },
  ],
});

const signer = (role_key: string) => ({
  role_key,
  method: "typed" as const,
  data: "Signed Name",
  timestamp: "2026-03-01T20:15:00.000Z",
});

const payload = (
  roles: string[],
  fields: SignaturePayload["fields"],
): SignaturePayload => ({ signers: roles.map(signer), fields });

const adultFields = {
  volunteer_name: "Alex Johnson",
  emergency_phone: "555-0100",
};

describe("validateWaiverPayload optional signer", () => {
  test("an adult can finish when the optional guardian is skipped", () => {
    expect(
      validateWaiverPayload(
        payload(["volunteer"], adultFields),
        definition(false),
        true,
      ),
    ).toMatchObject({ valid: true, errors: [] });
  });

  test("a skipped optional guardian may leave partial values behind", () => {
    expect(
      validateWaiverPayload(
        payload(["volunteer"], { ...adultFields, guardian_name: "" }),
        definition(false),
        true,
      ).valid,
    ).toBe(true);
  });

  test("an optional guardian who signs must fill their required fields", () => {
    const result = validateWaiverPayload(
      payload(["volunteer", "guardian"], adultFields),
      definition(false),
      true,
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(["Required field missing: Parent name"]);
  });

  test("an optional guardian who signs and fills their fields passes", () => {
    expect(
      validateWaiverPayload(
        payload(["volunteer", "guardian"], {
          ...adultFields,
          guardian_name: "Sam Johnson",
        }),
        definition(false),
        true,
      ).valid,
    ).toBe(true);
  });
});

describe("validateWaiverPayload required signer", () => {
  test("a missing required signer fails", () => {
    const result = validateWaiverPayload(
      payload(["volunteer"], { ...adultFields, guardian_name: "Sam Johnson" }),
      definition(true),
      true,
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Required signature missing for: Parent/Guardian",
    );
  });

  test("a required signer's fields are never relaxed", () => {
    const result = validateWaiverPayload(
      payload(["volunteer"], adultFields),
      definition(true),
      true,
    );

    expect(result.errors).toEqual([
      "Required signature missing for: Parent/Guardian",
      "Required field missing: Parent name",
    ]);
  });

  test("a required signer who signs must still fill their fields", () => {
    const result = validateWaiverPayload(
      payload(["guardian"], { guardian_name: "Sam Johnson" }),
      definition(false),
      true,
    );

    expect(result.errors).toEqual([
      "Required signature missing for: Volunteer",
      "Required field missing: Volunteer name",
      "Required field missing: Emergency phone",
    ]);
  });
});

describe("validateWaiverPayload fields without a known optional signer", () => {
  test("a field with no signer stays required", () => {
    const result = validateWaiverPayload(
      payload(["volunteer"], { volunteer_name: "Alex Johnson" }),
      definition(false),
      true,
    );

    expect(result.errors).toEqual(["Required field missing: Emergency phone"]);
  });

  test("a field whose signer is not in the definition stays required", () => {
    const base = definition(false);
    const result = validateWaiverPayload(
      payload(["volunteer"], adultFields),
      {
        ...base,
        fields: [
          ...base.fields,
          {
            field_key: "witness_name",
            field_type: "name",
            label: "Witness name",
            required: true,
            signer_role_key: "witness",
          },
        ],
      },
      true,
    );

    expect(result.errors).toEqual(["Required field missing: Witness name"]);
  });

  test("required fields are ignored entirely without strict validation", () => {
    expect(
      validateWaiverPayload(payload(["volunteer"], {}), definition(false))
        .valid,
    ).toBe(true);
  });
});
