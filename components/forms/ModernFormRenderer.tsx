"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Progress, ProgressLabel } from "@/components/ui/progress";
import { CloudUpload, Loader2 } from "lucide-react";
import { FormSchema, FormFieldDefinition } from "@/lib/forms/engine";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

type FormResponseValue =
  string | number | boolean | string[] | File | null | undefined;
type FormResponseData = Record<string, FormResponseValue>;

interface ModernFormRendererProps {
  schema: FormSchema;
  title: string;
  description?: string;
  onSubmit: (data: Record<string, unknown>) => void;
  isSubmitting?: boolean;
  userEmail?: string;
}

export function ModernFormRenderer({
  schema,
  title,
  description,
  onSubmit,
  isSubmitting = false,
  userEmail,
}: ModernFormRendererProps) {
  const [formData, setFormData] = useState<FormResponseData>({});
  const [activeSection, setActiveSection] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleFieldChange = (key: string, value: FormResponseValue) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) {
      const newErrors = { ...errors };
      delete newErrors[key];
      setErrors(newErrors);
    }
  };

  const validateCurrentSection = () => {
    const section = schema.sections[activeSection];
    const newErrors: Record<string, string> = {};
    let isValid = true;

    section.fields.forEach((field) => {
      if (
        field.required &&
        (formData[field.key] === undefined || formData[field.key] === "")
      ) {
        newErrors[field.key] = "This is a required question";
        isValid = false;
      }
    });

    setErrors(newErrors);
    return isValid;
  };

  const handleNext = () => {
    if (validateCurrentSection()) {
      setActiveSection((prev) =>
        Math.min(prev + 1, schema.sections.length - 1),
      );
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleBack = () => {
    setActiveSection((prev) => Math.max(prev - 1, 0));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validateCurrentSection()) {
      onSubmit(formData);
    }
  };

  const currentSection = schema?.sections?.[activeSection] || { fields: [] };
  const progress =
    schema?.sections?.length > 0
      ? ((activeSection + 1) / schema.sections.length) * 100
      : 0;

  const sectionCount = schema.sections?.length || 1;

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      <header className="grid gap-2">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {description && (
          <p className="text-muted-foreground text-sm whitespace-pre-wrap">
            {description}
          </p>
        )}
        {userEmail && (
          <p className="text-muted-foreground text-sm break-all">{userEmail}</p>
        )}
        <p className="text-muted-foreground text-sm">
          <span className="text-destructive">*</span> Indicates required
          question
        </p>
      </header>

      <form onSubmit={handleSubmit} className="grid gap-6">
        <FieldGroup className="gap-6">
          {currentSection.fields.map((field) => (
            <FormQuestion
              key={field.key}
              field={field}
              value={formData[field.key]}
              onChange={(val) => handleFieldChange(field.key, val)}
              error={errors[field.key]}
            />
          ))}
        </FieldGroup>

        {/* Navigation Controls */}
        <div className="flex flex-col gap-3 border-t pt-4">
          {sectionCount > 1 ? (
            <Progress value={progress}>
              <ProgressLabel className="text-muted-foreground text-xs font-normal">
                Page {activeSection + 1} of {sectionCount}
              </ProgressLabel>
            </Progress>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {activeSection > 0 && (
              <Button type="button" variant="outline" onClick={handleBack}>
                Back
              </Button>
            )}
            {activeSection < (schema.sections?.length || 0) - 1 ? (
              <Button type="button" onClick={handleNext}>
                Next
              </Button>
            ) : (
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <Loader2
                    data-icon="inline-start"
                    aria-hidden="true"
                    className="animate-spin"
                  />
                ) : null}
                Submit
              </Button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}

function FormQuestion({
  field,
  value,
  onChange,
  error,
}: {
  field: FormFieldDefinition;
  value: FormResponseValue;
  onChange: (value: FormResponseValue) => void;
  error?: string;
}) {
  const scalarValue =
    typeof value === "string" || typeof value === "number" ? value : "";
  const inputId = `question-${field.key}`;
  const isChoice =
    (field.type === "select" || field.type === "radio") && field.options;

  return (
    <Field data-invalid={Boolean(error)}>
      {isChoice || field.type === "checkbox" ? (
        <FieldTitle>
          {field.label}
          {field.required && <span className="text-destructive">*</span>}
        </FieldTitle>
      ) : (
        <FieldLabel htmlFor={inputId}>
          {field.label}
          {field.required && <span className="text-destructive">*</span>}
        </FieldLabel>
      )}
      {field.helpText && field.type !== "checkbox" && (
        <FieldDescription>{field.helpText}</FieldDescription>
      )}

      {field.type === "text" && (
        <Input
          id={inputId}
          placeholder="Your answer"
          value={scalarValue}
          aria-invalid={Boolean(error)}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {field.type === "email" && (
        <Input
          id={inputId}
          type="email"
          placeholder="Your email"
          value={scalarValue}
          aria-invalid={Boolean(error)}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {field.type === "tel" && (
        <Input
          id={inputId}
          type="tel"
          placeholder="Your answer"
          value={scalarValue}
          aria-invalid={Boolean(error)}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {field.type === "textarea" && (
        <Textarea
          id={inputId}
          placeholder="Your answer"
          value={scalarValue}
          aria-invalid={Boolean(error)}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {isChoice && field.options && (
        <RadioGroup
          aria-label={field.label}
          value={typeof value === "string" ? value : undefined}
          onValueChange={onChange}
        >
          {field.options.map((option) => (
            <div key={option.value} className="flex min-h-9 items-center gap-3">
              <RadioGroupItem
                value={option.value}
                id={`${field.key}-${option.value}`}
              />
              <Label
                htmlFor={`${field.key}-${option.value}`}
                className="font-normal"
              >
                {option.label}
              </Label>
            </div>
          ))}
        </RadioGroup>
      )}

      {field.type === "checkbox" && (
        <div className="flex min-h-9 items-start gap-3">
          <Checkbox
            id={field.key}
            checked={value === "true" || value === true}
            onCheckedChange={(checked) => onChange(checked)}
            className="mt-0.5"
          />
          <Label htmlFor={field.key} className="leading-snug font-normal">
            {field.helpText || "Yes"}
          </Label>
        </div>
      )}

      {field.type === "file" && (
        <div className="hover:bg-muted/50 relative flex min-h-16 items-center gap-3 rounded-lg border border-dashed px-4 py-3 transition-colors has-[:focus-visible]:border-ring has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50">
          <input
            id={inputId}
            type="file"
            className="absolute inset-0 size-full cursor-pointer opacity-0"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onChange(file);
            }}
          />
          <CloudUpload
            aria-hidden="true"
            className="text-muted-foreground size-5 shrink-0"
          />
          <span className="min-w-0 truncate text-sm font-medium">
            {value instanceof File ? value.name : "Add file"}
          </span>
        </div>
      )}

      {error && <FieldError>{error}</FieldError>}
    </Field>
  );
}
