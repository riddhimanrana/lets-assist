"use client";

/**
 * DynamicFormRenderer
 *
 * Renders a form defined by a FormSchema (JSON-schema-based form definitions
 * from plugin_data.org_form_definitions). Uses shadcn/ui components.
 *
 * Features:
 *  - Conditional field visibility
 *  - Client-side validation
 *  - Section-based layout
 *  - Support for all field types
 */

import { useState, useCallback, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type {
  FormSchema,
  FormUISchema,
  FormFieldDefinition,
  FormValidationError,
} from "@/lib/forms/engine";
import { validateSubmission, isFieldVisible } from "@/lib/forms/engine";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DynamicFormRendererProps {
  /** Form schema defining the fields */
  schema: FormSchema;
  /** UI hints for rendering */
  uiSchema?: FormUISchema;
  /** Initial form data (for editing existing submissions) */
  initialData?: Record<string, unknown>;
  /** Called when the form is submitted with valid data */
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  /** Whether the form is currently submitting */
  isSubmitting?: boolean;
  /** Additional className for the form wrapper */
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DynamicFormRenderer({
  schema,
  uiSchema,
  initialData = {},
  onSubmit,
  isSubmitting = false,
  className,
}: DynamicFormRendererProps) {
  const [formData, setFormData] = useState<Record<string, unknown>>(initialData);
  const [errors, setErrors] = useState<FormValidationError[]>([]);
  const [currentSection, setCurrentSection] = useState(0);

  const isMultiSection = schema.sections.length > 1;
  const submitLabel = uiSchema?.submitLabel ?? "Submit";

  // Update a single field value
  const updateField = useCallback((key: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    // Clear error for this field
    setErrors((prev) => prev.filter((e) => e.field !== key));
  }, []);

  // Get error message for a field
  const getFieldError = useCallback(
    (key: string): string | undefined => {
      return errors.find((e) => e.field === key)?.message;
    },
    [errors],
  );

  // Handle form submission
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      const result = validateSubmission(schema, formData);
      if (!result.valid) {
        setErrors(result.errors);
        // Scroll to first error
        const firstErrorField = result.errors[0]?.field;
        if (firstErrorField) {
          const el = document.getElementById(`field-${firstErrorField}`);
          el?.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        return;
      }

      setErrors([]);
      await onSubmit(formData);
    },
    [schema, formData, onSubmit],
  );

  // Current section navigation
  const canGoBack = currentSection > 0;
  const canGoNext = currentSection < schema.sections.length - 1;
  const isLastSection = currentSection === schema.sections.length - 1;

  // Section progress percentage
  const progressPercent = useMemo(() => {
    if (!isMultiSection) return 100;
    return Math.round(((currentSection + 1) / schema.sections.length) * 100);
  }, [currentSection, schema.sections.length, isMultiSection]);

  return (
    <form onSubmit={handleSubmit} className={className}>
      {/* Progress bar for multi-section forms */}
      {isMultiSection && uiSchema?.showProgress && (
        <div className="mb-6">
          <div className="flex justify-between text-sm text-muted-foreground mb-1">
            <span>
              Section {currentSection + 1} of {schema.sections.length}
            </span>
            <span>{progressPercent}%</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Render current section (or all sections if single) */}
      {(isMultiSection
        ? [schema.sections[currentSection]]
        : schema.sections
      ).map((section, sectionIndex) => (
        <Card key={sectionIndex} className="mb-6">
          {(section.title || section.description) && (
            <CardHeader>
              {section.title && <CardTitle>{section.title}</CardTitle>}
              {section.description && (
                <CardDescription>{section.description}</CardDescription>
              )}
            </CardHeader>
          )}
          <CardContent className="space-y-5">
            {section.fields.map((field) => {
              if (!isFieldVisible(field, formData)) return null;

              return (
                <div key={field.key} id={`field-${field.key}`}>
                  <FieldRenderer
                    field={field}
                    value={formData[field.key]}
                    onChange={(value) => updateField(field.key, value)}
                    error={getFieldError(field.key)}
                  />
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}

      {/* Navigation / Submit */}
      <div className="flex items-center gap-3 justify-end">
        {isMultiSection && canGoBack && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setCurrentSection((s) => s - 1)}
          >
            Back
          </Button>
        )}
        {isMultiSection && canGoNext && (
          <Button
            type="button"
            onClick={() => setCurrentSection((s) => s + 1)}
          >
            Next
          </Button>
        )}
        {(!isMultiSection || isLastSection) && (
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Submitting..." : submitLabel}
          </Button>
        )}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Individual Field Renderer
// ---------------------------------------------------------------------------

interface FieldRendererProps {
  field: FormFieldDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string;
}

function FieldRenderer({ field, value, onChange, error }: FieldRendererProps) {
  // Non-input fields
  if (field.type === "heading") {
    return (
      <div className="pt-2">
        <h3 className="text-lg font-semibold">{field.label}</h3>
        {field.helpText && (
          <p className="text-sm text-muted-foreground mt-1">{field.helpText}</p>
        )}
        <Separator className="mt-2" />
      </div>
    );
  }

  if (field.type === "paragraph") {
    return (
      <p className="text-sm text-muted-foreground">{field.label}</p>
    );
  }

  // Checkbox is special — label goes inline
  if (field.type === "checkbox") {
    return (
      <div className="space-y-1">
        <div className="flex items-center space-x-2">
          <Checkbox
            id={`input-${field.key}`}
            checked={Boolean(value)}
            onCheckedChange={(checked) => onChange(checked)}
          />
          <Label htmlFor={`input-${field.key}`} className="font-normal">
            {field.label}
            {field.required && <span className="text-destructive ml-0.5">*</span>}
          </Label>
        </div>
        {field.helpText && (
          <p className="text-xs text-muted-foreground ml-6">{field.helpText}</p>
        )}
        {error && <p className="text-xs text-destructive ml-6">{error}</p>}
      </div>
    );
  }

  // All other fields get a label wrapper
  return (
    <div className="space-y-2">
      <Label htmlFor={`input-${field.key}`}>
        {field.label}
        {field.required && <span className="text-destructive ml-0.5">*</span>}
      </Label>

      {field.helpText && (
        <p className="text-xs text-muted-foreground">{field.helpText}</p>
      )}

      <FieldInput field={field} value={value} onChange={onChange} />

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Field Input (the actual input element)
// ---------------------------------------------------------------------------

function FieldInput({ field, value, onChange }: Omit<FieldRendererProps, "error">) {
  switch (field.type) {
    case "text":
    case "email":
    case "tel":
      return (
        <Input
          id={`input-${field.key}`}
          type={field.type}
          placeholder={field.placeholder}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          minLength={field.validation?.minLength}
          maxLength={field.validation?.maxLength}
        />
      );

    case "number":
      return (
        <Input
          id={`input-${field.key}`}
          type="number"
          placeholder={field.placeholder}
          value={(value as number) ?? ""}
          onChange={(e) => onChange(e.target.valueAsNumber || "")}
          min={field.validation?.min}
          max={field.validation?.max}
        />
      );

    case "textarea":
      return (
        <Textarea
          id={`input-${field.key}`}
          placeholder={field.placeholder}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
          maxLength={field.validation?.maxLength}
        />
      );

    case "select":
      return (
        <Select
          value={(value as string) ?? ""}
          onValueChange={(v) => onChange(v)}
        >
          <SelectTrigger id={`input-${field.key}`}>
            <SelectValue placeholder={field.placeholder ?? "Select..."} />
          </SelectTrigger>
          <SelectContent>
            {field.options?.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );

    case "multi-select":
      return (
        <div className="space-y-2 border rounded-md p-3">
          {field.options?.map((opt) => {
            const selectedValues = (value as string[]) ?? [];
            const isChecked = selectedValues.includes(opt.value);
            return (
              <div key={opt.value} className="flex items-center space-x-2">
                <Checkbox
                  id={`input-${field.key}-${opt.value}`}
                  checked={isChecked}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      onChange([...selectedValues, opt.value]);
                    } else {
                      onChange(selectedValues.filter((v) => v !== opt.value));
                    }
                  }}
                />
                <Label
                  htmlFor={`input-${field.key}-${opt.value}`}
                  className="font-normal"
                >
                  {opt.label}
                </Label>
              </div>
            );
          })}
        </div>
      );

    case "radio":
      return (
        <RadioGroup
          value={(value as string) ?? ""}
          onValueChange={(v) => onChange(v)}
        >
          {field.options?.map((opt) => (
            <div key={opt.value} className="flex items-center space-x-2">
              <RadioGroupItem
                value={opt.value}
                id={`input-${field.key}-${opt.value}`}
              />
              <Label
                htmlFor={`input-${field.key}-${opt.value}`}
                className="font-normal"
              >
                {opt.label}
              </Label>
            </div>
          ))}
        </RadioGroup>
      );

    case "date":
      return (
        <Input
          id={`input-${field.key}`}
          type="date"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "file":
      return (
        <Input
          id={`input-${field.key}`}
          type="file"
          accept={field.validation?.fileTypes?.join(",")}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              onChange(file);
            }
          }}
        />
      );

    default:
      return (
        <Input
          id={`input-${field.key}`}
          type="text"
          placeholder={field.placeholder}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}
