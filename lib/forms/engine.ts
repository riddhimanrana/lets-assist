/**
 * Dynamic Forms Engine
 *
 * Server-side utilities for working with JSON-schema-based form definitions
 * stored in `plugin_data.org_form_definitions`.
 *
 * Handles:
 *  - Form schema validation
 *  - Submission validation against form schema
 *  - Conditional field logic resolution
 *  - Payment integration (checks `requires_payment`)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Individual field definition within a form schema */
export interface FormFieldDefinition {
  /** Unique key for this field */
  key: string;
  /** Display label */
  label: string;
  /** Field type */
  type:
    | "text"
    | "email"
    | "tel"
    | "number"
    | "textarea"
    | "select"
    | "multi-select"
    | "checkbox"
    | "radio"
    | "date"
    | "file"
    | "heading"
    | "paragraph";
  /** Placeholder text */
  placeholder?: string;
  /** Whether the field is required */
  required?: boolean;
  /** Help text shown below the field */
  helpText?: string;
  /** Default value */
  defaultValue?: unknown;
  /** Options for select/multi-select/radio */
  options?: Array<{ value: string; label: string }>;

  /** Validation rules */
  validation?: {
    pattern?: string;
    patternMessage?: string;
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    fileTypes?: string[];    // MIME types for file fields
    maxFileSizeMb?: number;
  };

  /** Conditional visibility */
  condition?: {
    /** Field key to check */
    field: string;
    /** Operator */
    operator: "equals" | "not_equals" | "contains" | "not_empty" | "empty";
    /** Value to compare against */
    value?: unknown;
  };
}

/** Section grouping for form UI */
export interface FormSection {
  /** Section title */
  title?: string;
  /** Section description */
  description?: string;
  /** Fields in this section */
  fields: FormFieldDefinition[];
}

/** Complete form schema stored in `form_schema` column */
export interface FormSchema {
  /** Schema version for forward compatibility */
  version: 1;
  /** Form sections (or flat list of fields) */
  sections: FormSection[];
}

/** UI Schema — rendering hints stored in `ui_schema` column */
export interface FormUISchema {
  /** Layout mode */
  layout?: "single-column" | "two-column";
  /** Submit button text */
  submitLabel?: string;
  /** Confirmation message after submission */
  confirmationMessage?: string;
  /** Whether to show a progress bar for multi-section forms */
  showProgress?: boolean;
}

/** A single field validation error */
export interface FormValidationError {
  field: string;
  message: string;
}

/** Result of validating a submission */
export interface FormValidationResult {
  valid: boolean;
  errors: FormValidationError[];
}

// ---------------------------------------------------------------------------
// Schema helpers
// ---------------------------------------------------------------------------

/**
 * Get all fields from a form schema, flattened.
 */
export function getAllFields(schema: FormSchema): FormFieldDefinition[] {
  return schema.sections.flatMap((section) => section.fields);
}

/**
 * Check if a field should be visible given the current form data.
 */
export function isFieldVisible(
  field: FormFieldDefinition,
  data: Record<string, unknown>,
): boolean {
  if (!field.condition) return true;

  const { field: conditionField, operator, value } = field.condition;
  const currentValue = data[conditionField];

  switch (operator) {
    case "equals":
      return currentValue === value;
    case "not_equals":
      return currentValue !== value;
    case "contains":
      return typeof currentValue === "string" && typeof value === "string"
        ? currentValue.includes(value)
        : false;
    case "not_empty":
      return currentValue != null && currentValue !== "" && currentValue !== false;
    case "empty":
      return currentValue == null || currentValue === "" || currentValue === false;
    default:
      return true;
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a form submission against its schema.
 * Only validates visible fields (respects conditional logic).
 */
export function validateSubmission(
  schema: FormSchema,
  data: Record<string, unknown>,
): FormValidationResult {
  const errors: FormValidationError[] = [];
  const allFields = getAllFields(schema);

  for (const field of allFields) {
    // Skip hidden fields
    if (!isFieldVisible(field, data)) continue;

    // Skip non-input fields
    if (field.type === "heading" || field.type === "paragraph") continue;

    const value = data[field.key];

    // Required check
    if (field.required) {
      if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) {
        errors.push({ field: field.key, message: `${field.label} is required` });
        continue;
      }
    }

    // Skip further validation if empty and not required
    if (value == null || value === "") continue;

    // Type-specific validation
    if (field.validation) {
      const v = field.validation;

      if (typeof value === "string") {
        if (v.minLength && value.length < v.minLength) {
          errors.push({
            field: field.key,
            message: `${field.label} must be at least ${v.minLength} characters`,
          });
        }
        if (v.maxLength && value.length > v.maxLength) {
          errors.push({
            field: field.key,
            message: `${field.label} must be at most ${v.maxLength} characters`,
          });
        }
        if (v.pattern) {
          const regex = new RegExp(v.pattern);
          if (!regex.test(value)) {
            errors.push({
              field: field.key,
              message: v.patternMessage ?? `${field.label} format is invalid`,
            });
          }
        }
      }

      if (typeof value === "number") {
        if (v.min != null && value < v.min) {
          errors.push({
            field: field.key,
            message: `${field.label} must be at least ${v.min}`,
          });
        }
        if (v.max != null && value > v.max) {
          errors.push({
            field: field.key,
            message: `${field.label} must be at most ${v.max}`,
          });
        }
      }
    }

    // Email format check
    if (field.type === "email" && typeof value === "string") {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(value)) {
        errors.push({ field: field.key, message: `${field.label} must be a valid email` });
      }
    }

    // Phone format check
    if (field.type === "tel" && typeof value === "string") {
      const digitsOnly = value.replace(/\D/g, "");
      if (digitsOnly.length < 10) {
        errors.push({ field: field.key, message: `${field.label} must be a valid phone number` });
      }
    }

    // Select/radio: value must be in options
    if ((field.type === "select" || field.type === "radio") && field.options) {
      const validValues = field.options.map((o) => o.value);
      if (typeof value === "string" && !validValues.includes(value)) {
        errors.push({
          field: field.key,
          message: `${field.label}: invalid selection`,
        });
      }
    }

    // Multi-select: all values must be in options
    if (field.type === "multi-select" && field.options && Array.isArray(value)) {
      const validValues = field.options.map((o) => o.value);
      for (const v of value) {
        if (!validValues.includes(v as string)) {
          errors.push({
            field: field.key,
            message: `${field.label}: invalid selection "${v}"`,
          });
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Schema builder helpers (for plugins to construct schemas programmatically)
// ---------------------------------------------------------------------------

export function createFormSchema(sections: FormSection[]): FormSchema {
  return { version: 1, sections };
}

export function createSection(
  fields: FormFieldDefinition[],
  options?: { title?: string; description?: string },
): FormSection {
  return {
    title: options?.title,
    description: options?.description,
    fields,
  };
}

export function textField(key: string, label: string, opts?: Partial<FormFieldDefinition>): FormFieldDefinition {
  return { key, label, type: "text", ...opts };
}

export function emailField(key: string, label: string, opts?: Partial<FormFieldDefinition>): FormFieldDefinition {
  return { key, label, type: "email", ...opts };
}

export function phoneField(key: string, label: string, opts?: Partial<FormFieldDefinition>): FormFieldDefinition {
  return { key, label, type: "tel", ...opts };
}

export function numberField(key: string, label: string, opts?: Partial<FormFieldDefinition>): FormFieldDefinition {
  return { key, label, type: "number", ...opts };
}

export function selectField(
  key: string,
  label: string,
  options: Array<{ value: string; label: string }>,
  opts?: Partial<FormFieldDefinition>,
): FormFieldDefinition {
  return { key, label, type: "select", options, ...opts };
}

export function checkboxField(key: string, label: string, opts?: Partial<FormFieldDefinition>): FormFieldDefinition {
  return { key, label, type: "checkbox", ...opts };
}

export function textareaField(key: string, label: string, opts?: Partial<FormFieldDefinition>): FormFieldDefinition {
  return { key, label, type: "textarea", ...opts };
}
