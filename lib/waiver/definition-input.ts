import { z } from "zod";

export const MAX_WAIVER_DEFINITION_SIGNERS = 16;
export const MAX_WAIVER_DEFINITION_FIELDS = 500;
export const MAX_WAIVER_DEFINITION_JSON_BYTES = 256 * 1024;

const roleKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.:-]+$/u);

const fieldKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(
    (value) =>
      Array.from(value).every((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint > 0x1f && codePoint !== 0x7f;
      }),
    "Field keys cannot contain control characters",
  );

const rectSchema = z
  .object({
    x: z.number().finite().min(0).max(100_000),
    y: z.number().finite().min(0).max(100_000),
    width: z.number().finite().positive().max(100_000),
    height: z.number().finite().positive().max(100_000),
  })
  .strict();

const metaSchema = z
  .record(z.string().max(128), z.unknown())
  .nullable()
  .optional();

const detectedFieldTypeSchema = z.enum([
  "signature",
  "initial",
  "name",
  "date",
  "email",
  "phone",
  "address",
  "text",
  "checkbox",
  "radio",
  "dropdown",
  "button",
  "unknown",
]);

const customFieldTypeSchema = z.enum([
  "signature",
  "initial",
  "name",
  "date",
  "email",
  "phone",
  "address",
  "text",
  "checkbox",
  "radio",
  "dropdown",
]);

const signerSchema = z
  .object({
    roleKey: roleKeySchema,
    label: z.string().trim().min(1).max(120),
    required: z.boolean(),
    orderIndex: z
      .number()
      .int()
      .min(0)
      .max(MAX_WAIVER_DEFINITION_SIGNERS - 1),
    rules: z.record(z.string().max(128), z.unknown()).nullable().optional(),
  })
  .strict();

const detectedFieldSchema = z
  .object({
    fieldKey: fieldKeySchema,
    signerRoleKey: roleKeySchema.optional(),
    required: z.boolean(),
    label: z.string().trim().min(1).max(200).optional(),
    fieldType: detectedFieldTypeSchema,
    pageIndex: z.number().int().min(0).max(999),
    rect: rectSchema,
    pdfFieldName: z.string().trim().min(1).max(200).optional(),
    meta: metaSchema,
  })
  .strict();

const customFieldSchema = z
  .object({
    id: fieldKeySchema,
    fieldKey: fieldKeySchema.optional(),
    label: z.string().trim().min(1).max(200),
    signerRoleKey: roleKeySchema,
    fieldType: customFieldTypeSchema,
    required: z.boolean(),
    pageIndex: z.number().int().min(0).max(999),
    rect: rectSchema,
    meta: metaSchema,
  })
  .strict();

export const waiverDefinitionInputSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    signers: z.array(signerSchema).min(1).max(MAX_WAIVER_DEFINITION_SIGNERS),
    fields: z
      .object({
        detected: z.record(fieldKeySchema, detectedFieldSchema),
        custom: z.array(customFieldSchema).max(MAX_WAIVER_DEFINITION_FIELDS),
      })
      .strict(),
  })
  .strict()
  .superRefine((definition, context) => {
    const roleKeys = definition.signers.map((signer) => signer.roleKey);
    if (new Set(roleKeys).size !== roleKeys.length) {
      context.addIssue({
        code: "custom",
        path: ["signers"],
        message: "Signer role keys must be unique",
      });
    }

    const detectedFields = Object.values(definition.fields.detected);
    if (
      detectedFields.length + definition.fields.custom.length >
      MAX_WAIVER_DEFINITION_FIELDS
    ) {
      context.addIssue({
        code: "custom",
        path: ["fields"],
        message: "Too many waiver fields",
      });
    }

    const signerKeys = new Set(roleKeys);
    const fieldKeys = [
      ...detectedFields.map((field) => field.fieldKey),
      ...definition.fields.custom.map((field) => field.fieldKey ?? field.id),
    ];
    if (new Set(fieldKeys).size !== fieldKeys.length) {
      context.addIssue({
        code: "custom",
        path: ["fields"],
        message: "Waiver field keys must be unique",
      });
    }

    for (const [index, field] of [
      ...detectedFields,
      ...definition.fields.custom,
    ].entries()) {
      if (field.signerRoleKey && !signerKeys.has(field.signerRoleKey)) {
        context.addIssue({
          code: "custom",
          path: ["fields", index, "signerRoleKey"],
          message: "Field references an unknown signer role",
        });
      }
    }

    let serializedDefinition: string;
    try {
      serializedDefinition = JSON.stringify(definition);
    } catch {
      context.addIssue({
        code: "custom",
        message: "Waiver definition must contain JSON-compatible values",
      });
      return;
    }

    if (
      new TextEncoder().encode(serializedDefinition).byteLength >
      MAX_WAIVER_DEFINITION_JSON_BYTES
    ) {
      context.addIssue({
        code: "custom",
        message: "Waiver definition payload is too large",
      });
    }
  });

export type ValidatedWaiverDefinitionInput = z.infer<
  typeof waiverDefinitionInputSchema
>;
