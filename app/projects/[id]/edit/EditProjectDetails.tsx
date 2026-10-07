"use client";

import { Controller, type UseFormReturn } from "react-hook-form";

import {
  FormField,
  FormGroup,
  StepSection,
  ToggleRow,
} from "@/app/projects/create/form-parts";
import { Input } from "@/components/ui/input";
import LocationAutocomplete from "@/components/ui/location-autocomplete";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  DESCRIPTION_LIMIT,
  LOCATION_LIMIT,
  TITLE_LIMIT,
  type FormValues,
} from "./edit-project-form";

const VERIFICATION_OPTIONS: Array<{
  value: FormValues["verification_method"];
  label: string;
  description: string;
}> = [
  {
    value: "qr-code",
    label: "QR code check-in",
    description: "Volunteers scan a QR code at the event to check in",
  },
  {
    value: "manual",
    label: "Manual check-in",
    description:
      "Project coordinators manually check in volunteers from the attendance page",
  },
  {
    value: "auto",
    label: "Automatic check-in",
    description:
      "System automatically checks in volunteers at their scheduled time",
  },
  {
    value: "signup-only",
    label: "Sign-up only",
    description: "No check-in process, only tracks who signed up",
  },
];

const VISIBILITY_OPTIONS: Array<{
  value: FormValues["visibility"];
  label: string;
  description: string;
  organizationOnly?: boolean;
}> = [
  {
    value: "public",
    label: "Public (everyone)",
    description: "Appears on the home feed and in search results.",
  },
  {
    value: "unlisted",
    label: "Unlisted (link only)",
    description: "Only people with the direct link can view or sign up.",
  },
  {
    value: "organization_only",
    label: "Organization members only",
    description: "Visible only to members of your organization.",
    organizationOnly: true,
  },
];

function Counter({ current, max }: { current: number; max: number }) {
  const percentage = (current / max) * 100;
  return (
    <span
      className={cn(
        "text-xs tabular-nums transition-colors",
        percentage >= 90
          ? "text-destructive"
          : percentage >= 75
            ? "text-warning"
            : "text-muted-foreground",
      )}
    >
      {current}/{max}
    </span>
  );
}

function OptionSelect<T extends string>({
  id,
  value,
  onChange,
  options,
  placeholder,
  invalid,
}: {
  id: string;
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; description: string }>;
  placeholder: string;
  invalid: boolean;
}) {
  return (
    <Select onValueChange={(next) => onChange(next as T)} value={value}>
      <SelectTrigger id={id} aria-invalid={invalid} className="w-full">
        <SelectValue placeholder={placeholder}>
          {options.find((option) => option.value === value)?.label ??
            placeholder}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            <span className="grid gap-0.5">
              <span>{option.label}</span>
              <span className="text-muted-foreground text-xs">
                {option.description}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** What the project is, how people sign up, and who can see it. */
export function EditProjectDetails({
  form,
  hasOrganization,
  titleChars,
  locationChars,
  onTitleChars,
  onLocationChars,
}: {
  form: UseFormReturn<FormValues>;
  hasOrganization: boolean;
  titleChars: number;
  locationChars: number;
  onTitleChars: (length: number) => void;
  onLocationChars: (length: number) => void;
}) {
  return (
    <>
      <StepSection title="Basic information">
        <FormGroup>
          <Controller
            control={form.control}
            name="title"
            render={({ field, fieldState }) => (
              <FormField
                label="Project title"
                htmlFor={field.name}
                hint={<Counter current={titleChars} max={TITLE_LIMIT} />}
                error={fieldState.error?.message}
              >
                <Input
                  id={field.name}
                  placeholder="Enter project title"
                  {...field}
                  onChange={(e) => {
                    field.onChange(e);
                    onTitleChars(e.target.value.length);
                  }}
                  maxLength={TITLE_LIMIT}
                  aria-invalid={fieldState.invalid}
                />
              </FormField>
            )}
          />

          <Controller
            control={form.control}
            name="description"
            render={({ field, fieldState }) => (
              <FormField
                label="Description"
                htmlFor={field.name}
                error={fieldState.error?.message}
              >
                <RichTextEditor
                  content={field.value}
                  onChange={field.onChange}
                  placeholder="Enter project description..."
                  maxLength={DESCRIPTION_LIMIT}
                />
              </FormField>
            )}
          />

          <Controller
            control={form.control}
            name="location"
            render={({ field, fieldState }) => (
              <FormField
                label="Location"
                htmlFor="location"
                hint={<Counter current={locationChars} max={LOCATION_LIMIT} />}
                error={fieldState.error?.message}
                errorId="location-error"
              >
                <LocationAutocomplete
                  id="location"
                  value={form.getValues().location_data}
                  onChangeAction={(location_data) => {
                    if (location_data) {
                      // Keep the text field and the structured location in step.
                      field.onChange(location_data.text);
                      form.setValue("location_data", location_data);
                      onLocationChars(location_data.text.length);
                    } else {
                      field.onChange("");
                      form.setValue("location_data", undefined);
                      onLocationChars(0);
                    }
                  }}
                  maxLength={LOCATION_LIMIT}
                  required
                  error={!!fieldState.error}
                  errorMessage={fieldState.error?.message?.toString()}
                  aria-invalid={fieldState.invalid}
                  aria-errormessage={
                    fieldState.error ? "location-error" : undefined
                  }
                />
              </FormField>
            )}
          />
        </FormGroup>
      </StepSection>

      <StepSection title="Sign-up settings">
        <FormGroup>
          <Controller
            control={form.control}
            name="require_login"
            render={({ field }) => (
              <ToggleRow
                id={field.name}
                label="Require account"
                description="Require volunteers to create an account to sign up"
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            )}
          />
          <Controller
            control={form.control}
            name="enable_volunteer_comments"
            render={({ field }) => (
              <ToggleRow
                id={field.name}
                label="Enable volunteer comments"
                description="Allow volunteers to include a short note when signing up"
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            )}
          />
          <Controller
            control={form.control}
            name="show_attendees_publicly"
            render={({ field }) => (
              <ToggleRow
                id={field.name}
                label="Show attendees publicly"
                description="Display attendee count on the public project page"
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            )}
          />
        </FormGroup>
      </StepSection>

      <StepSection title="Check-in and visibility">
        <FormGroup>
          <Controller
            control={form.control}
            name="verification_method"
            render={({ field, fieldState }) => (
              <FormField
                label="Verification method"
                htmlFor={field.name}
                error={fieldState.error?.message}
              >
                <OptionSelect
                  id={field.name}
                  value={field.value}
                  onChange={field.onChange}
                  options={VERIFICATION_OPTIONS}
                  placeholder="Select verification method"
                  invalid={fieldState.invalid}
                />
              </FormField>
            )}
          />
          <Controller
            control={form.control}
            name="visibility"
            render={({ field, fieldState }) => (
              <FormField
                label="Project visibility"
                htmlFor={field.name}
                description="Choose who can discover and view your project on the platform."
                error={fieldState.error?.message}
              >
                <OptionSelect
                  id={field.name}
                  value={field.value}
                  onChange={field.onChange}
                  options={VISIBILITY_OPTIONS.filter(
                    (option) => !option.organizationOnly || hasOrganization,
                  )}
                  placeholder="Select visibility"
                  invalid={fieldState.invalid}
                />
              </FormField>
            )}
          />
        </FormGroup>
      </StepSection>
    </>
  );
}
