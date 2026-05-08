"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { AlertCircle, CloudUpload, FileText, Loader2 } from "lucide-react";
import { FormSchema, FormFieldDefinition } from "@/lib/forms/engine";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

interface ModernFormRendererProps {
  schema: FormSchema;
  title: string;
  description?: string;
  onSubmit: (data: Record<string, any>) => void;
  isSubmitting?: boolean;
  userEmail?: string;
}

export function ModernFormRenderer({
  schema,
  title,
  description,
  onSubmit,
  isSubmitting = false,
  userEmail
}: ModernFormRendererProps) {
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [activeSection, setActiveSection] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleFieldChange = (key: string, value: any) => {
    setFormData(prev => ({ ...prev, [key]: value }));
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

    section.fields.forEach(field => {
      if (field.required && (formData[field.key] === undefined || formData[field.key] === "")) {
        newErrors[field.key] = "This is a required question";
        isValid = false;
      }
    });

    setErrors(newErrors);
    return isValid;
  };

  const handleNext = () => {
    if (validateCurrentSection()) {
      setActiveSection(prev => Math.min(prev + 1, schema.sections.length - 1));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleBack = () => {
    setActiveSection(prev => Math.max(prev - 1, 0));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validateCurrentSection()) {
      onSubmit(formData);
    }
  };

  const currentSection = schema?.sections?.[activeSection] || { fields: [] };
  const progress = schema?.sections?.length > 0 ? ((activeSection + 1) / schema.sections.length) * 100 : 0;

  return (
    <div className="max-w-[770px] mx-auto space-y-3">
      {/* Form Header Card */}
      <Card className="border-none shadow-sm overflow-hidden rounded-lg">
        <div className="h-2.5 bg-primary w-full" />
        <CardHeader className="pt-6 pb-4">
          <CardTitle className="text-[32px] font-normal leading-tight">{title}</CardTitle>
          {description && (
            <div className="mt-4 text-sm whitespace-pre-wrap leading-relaxed text-muted-foreground">
              {description}
            </div>
          )}
          <div className="mt-6 pt-4 border-t border-border flex flex-col gap-2">
            {userEmail && (
              <div className="text-sm font-bold flex items-center gap-1">
                <span>{userEmail}</span>
              </div>
            )}
            <div className="text-[14px] text-destructive mt-2">* Indicates required question</div>
          </div>
        </CardHeader>
      </Card>

      {/* Form Fields */}
      <form onSubmit={handleSubmit} className="space-y-3">
        {currentSection.fields.map((field) => (
          <FormQuestionCard
            key={field.key}
            field={field}
            value={formData[field.key]}
            onChange={(val) => handleFieldChange(field.key, val)}
            error={errors[field.key]}
          />
        ))}

        {/* Navigation Controls */}
        <div className="flex items-center justify-between pt-4 pb-12">
          <div className="flex gap-4">
            {activeSection > 0 && (
              <Button
                type="button"
                variant="ghost"
                onClick={handleBack}
                className="font-medium"
              >
                Back
              </Button>
            )}
            {activeSection < (schema.sections?.length || 0) - 1 ? (
              <Button
                type="button"
                onClick={handleNext}
                className="px-6 font-medium"
              >
                Next
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={isSubmitting}
                className="px-8 font-medium"
              >
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Submit
              </Button>
            )}
          </div>

          <div className="flex flex-col items-end gap-2">
            <div className="w-48">
              <Progress value={progress} className="h-2 bg-muted [&>div]:bg-primary" />
            </div>
            <span className="text-xs text-muted-foreground">Page {activeSection + 1} of {schema.sections?.length || 1}</span>
          </div>
        </div>
      </form>
    </div>
  );
}

function FormQuestionCard({
  field,
  value,
  onChange,
  error
}: {
  field: FormFieldDefinition;
  value: any;
  onChange: (val: any) => void;
  error?: string;
}) {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <Card
      className={cn(
        "border-none shadow-sm transition-shadow duration-200 rounded-lg",
        isFocused && "shadow-md",
        error && "border-l-4 border-l-destructive"
      )}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
    >
      <CardHeader className="pb-3">
        <CardTitle className="text-[16px] font-normal leading-6 flex items-start gap-1">
          {field.label}
          {field.required && <span className="text-destructive">*</span>}
        </CardTitle>
        {field.helpText && (
          <CardDescription className="text-[12px] text-muted-foreground mt-1">
            {field.helpText}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="pb-6">
        <div className="mt-2">
          {field.type === "text" && (
            <div className="relative">
              <Input
                placeholder="Your answer"
                value={value || ""}
                onChange={(e) => onChange(e.target.value)}
                className="border-0 border-b border-border rounded-none px-0 focus-visible:ring-0 focus-visible:border-b-2 focus-visible:border-primary transition-all bg-transparent shadow-none h-9 text-[14px]"
              />
            </div>
          )}

          {field.type === "email" && (
            <Input
              type="email"
              placeholder="Your email"
              value={value || ""}
              onChange={(e) => onChange(e.target.value)}
              className="border-0 border-b border-border rounded-none px-0 focus-visible:ring-0 focus-visible:border-b-2 focus-visible:border-primary transition-all bg-transparent shadow-none h-9 text-[14px]"
            />
          )}

          {field.type === "tel" && (
            <Input
              type="tel"
              placeholder="Your answer"
              value={value || ""}
              onChange={(e) => onChange(e.target.value)}
              className="border-0 border-b border-border rounded-none px-0 focus-visible:ring-0 focus-visible:border-b-2 focus-visible:border-primary transition-all bg-transparent shadow-none h-9 text-[14px]"
            />
          )}

          {field.type === "textarea" && (
            <Textarea
              placeholder="Your answer"
              value={value || ""}
              onChange={(e) => onChange(e.target.value)}
              className="border-0 border-b border-border rounded-none px-0 focus-visible:ring-0 focus-visible:border-b-2 focus-visible:border-primary transition-all bg-transparent shadow-none min-h-[40px] resize-none text-[14px]"
            />
          )}

          {(field.type === "select" || field.type === "radio") && field.options && (
            <div className="space-y-3">
              <RadioGroup value={value} onValueChange={onChange}>
                {field.options.map((option) => (
                  <div key={option.value} className="flex items-center space-x-3 space-y-0">
                    <RadioGroupItem
                      value={option.value}
                      id={`${field.key}-${option.value}`}
                    />
                    <Label
                      htmlFor={`${field.key}-${option.value}`}
                      className="text-[14px] font-normal cursor-pointer leading-none"
                    >
                      {option.label}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
          )}

          {field.type === "checkbox" && (
            <div className="flex items-start space-x-3">
              <Checkbox
                id={field.key}
                checked={value === "true" || value === true}
                onCheckedChange={(checked) => onChange(checked)}
                className="mt-1"
              />
              <Label
                htmlFor={field.key}
                className="text-[14px] font-normal leading-relaxed cursor-pointer"
              >
                {field.helpText || "Yes"}
              </Label>
            </div>
          )}

          {field.type === "file" && (
            <div className="space-y-4">
              <div className="flex flex-col items-center justify-center border-2 border-dashed border-border rounded-lg p-6 bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer relative">
                <input
                  type="file"
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onChange(file);
                  }}
                />
                <div className="flex flex-col items-center gap-2">
                  <CloudUpload className="h-8 w-8 text-muted-foreground" />
                  <div className="text-sm font-medium text-primary">Add file</div>
                  {value instanceof File && (
                    <div className="mt-2 flex items-center gap-2 bg-background px-3 py-1 rounded border shadow-sm">
                      <FileText className="h-4 w-4 text-primary" />
                      <span className="text-xs truncate max-w-[200px]">{value.name}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="mt-4 flex items-center gap-2 text-destructive text-[12px]">
            <AlertCircle className="h-4 w-4" />
            <span>{error}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
