"use client";

import type { ChangeEvent } from "react";
import { Controller, type UseFormReturn } from "react-hook-form";
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Globe,
  Loader2,
  Upload,
  X,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import {
  DESCRIPTION_MAX_LENGTH,
  NAME_MAX_LENGTH,
  ORG_TYPE_LABELS,
  ORG_TYPE_OPTIONS,
  USERNAME_MAX_LENGTH,
  WEBSITE_MAX_LENGTH,
  type OrganizationFormValues,
} from "./organization-form-schema";

type OrganizationProfileFieldsProps = {
  form: UseFormReturn<OrganizationFormValues>;
  isUploading: boolean;
  checkingUsername: boolean;
  usernameAvailable: boolean | null;
  descriptionLength: number;
  onImageUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemoveLogo: () => void;
  onUsernameEdited: () => void;
  onUsernameBlur: (value: string) => void;
  onDescriptionLengthChange: (length: number) => void;
};

/** Logo, name, username, description, website and type: one form, one Save. */
export default function OrganizationProfileFields({
  form,
  isUploading,
  checkingUsername,
  usernameAvailable,
  descriptionLength,
  onImageUpload,
  onRemoveLogo,
  onUsernameEdited,
  onUsernameBlur,
  onDescriptionLengthChange,
}: OrganizationProfileFieldsProps) {
  return (
    <>
      <Controller
        control={form.control}
        name="logoUrl"
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldTitle>Logo</FieldTitle>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <Avatar className="size-16">
                <AvatarImage
                  src={field.value || undefined}
                  alt="Organization logo"
                />
                <AvatarFallback>
                  <Building2 className="text-muted-foreground size-7" />
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-wrap gap-2">
                <input
                  id="logo-upload"
                  type="file"
                  className="hidden"
                  accept="image/jpeg,image/png,image/jpg,image/webp"
                  onChange={onImageUpload}
                  disabled={isUploading}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    document.getElementById("logo-upload")?.click()
                  }
                  disabled={isUploading}
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload />
                      {field.value ? "Change logo" : "Upload logo"}
                    </>
                  )}
                </Button>
                {field.value && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={onRemoveLogo}
                    disabled={isUploading}
                  >
                    <X />
                    Remove
                  </Button>
                )}
              </div>
            </div>
            <FieldDescription>
              Square image, at least 200×200px, up to 5 MB. A new logo is saved
              as soon as you crop it.
            </FieldDescription>
            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
          </Field>
        )}
      />

      <Controller
        control={form.control}
        name="name"
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={field.name}>Organization name</FieldLabel>
            <Input
              id={field.name}
              {...field}
              placeholder="Enter organization name"
              maxLength={NAME_MAX_LENGTH}
              aria-invalid={fieldState.invalid}
            />
            <FieldDescription>
              This is your organization&apos;s display name
            </FieldDescription>
            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
          </Field>
        )}
      />

      <Controller
        control={form.control}
        name="username"
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={field.name}>Username</FieldLabel>
            <InputGroup>
              <InputGroupInput
                id={field.name}
                {...field}
                placeholder="Enter organization username"
                maxLength={USERNAME_MAX_LENGTH}
                onChange={(e) => {
                  const noSpaces = e.target.value.replace(/\s/g, "");
                  field.onChange(noSpaces);
                  // Clear errors and reset availability when typing
                  if (form.formState.errors.username) {
                    form.clearErrors("username");
                  }
                  onUsernameEdited();
                }}
                onBlur={(e) => {
                  field.onBlur();
                  onUsernameBlur(e.target.value);
                }}
                aria-invalid={fieldState.invalid}
              />
              {checkingUsername && (
                <InputGroupAddon align="inline-end">
                  <Loader2
                    className="animate-spin"
                    aria-label="Checking username"
                  />
                </InputGroupAddon>
              )}
              {usernameAvailable !== null && !checkingUsername && (
                <InputGroupAddon align="inline-end">
                  {usernameAvailable ? (
                    <CheckCircle2
                      className="text-success"
                      aria-label="Username available"
                    />
                  ) : (
                    <AlertCircle
                      className="text-destructive"
                      aria-label="Username unavailable"
                    />
                  )}
                </InputGroupAddon>
              )}
            </InputGroup>
            <FieldDescription>
              Used in your organization&apos;s URL.
              <span className="mt-1 block font-mono text-xs break-all">
                lets-assist.com/organization/{field.value || "username"}
              </span>
            </FieldDescription>
            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
          </Field>
        )}
      />

      <Controller
        control={form.control}
        name="description"
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <div className="flex items-center justify-between gap-2">
              <FieldLabel htmlFor={field.name}>Description</FieldLabel>
              <span className="text-muted-foreground text-xs tabular-nums">
                {descriptionLength}/{DESCRIPTION_MAX_LENGTH}
              </span>
            </div>
            <Textarea
              id={field.name}
              {...field}
              placeholder="Describe your organization"
              className="resize-none"
              rows={4}
              maxLength={DESCRIPTION_MAX_LENGTH}
              onChange={(e) => {
                field.onChange(e);
                onDescriptionLengthChange(e.target.value.length);
              }}
              aria-invalid={fieldState.invalid}
            />
            <FieldDescription>
              A brief description of your organization
            </FieldDescription>
            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
          </Field>
        )}
      />

      <Controller
        control={form.control}
        name="website"
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={field.name}>Website</FieldLabel>
            <InputGroup>
              <InputGroupAddon>
                <Globe />
              </InputGroupAddon>
              <InputGroupInput
                id={field.name}
                {...field}
                placeholder="https://your-website.com"
                maxLength={WEBSITE_MAX_LENGTH}
                onBlur={(e) => {
                  const value = e.target.value.trim();
                  if (
                    value &&
                    !value.startsWith("https://") &&
                    !value.startsWith("http://")
                  ) {
                    field.onChange(`https://${value}`);
                  }
                }}
                aria-invalid={fieldState.invalid}
              />
            </InputGroup>
            <FieldDescription>
              Optional. Must start with https:// or http://
            </FieldDescription>
            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
          </Field>
        )}
      />

      <Controller
        control={form.control}
        name="type"
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={field.name}>Organization type</FieldLabel>
            <Select onValueChange={field.onChange} value={field.value}>
              <SelectTrigger
                id={field.name}
                className={cn(
                  "w-full",
                  !field.value && "text-muted-foreground",
                )}
                aria-invalid={fieldState.invalid}
              >
                <SelectValue placeholder="Select organization type">
                  {field.value
                    ? ORG_TYPE_LABELS[field.value]
                    : "Select organization type"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {ORG_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {ORG_TYPE_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription>
              Choose the type that best describes your organization
            </FieldDescription>
            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
          </Field>
        )}
      />
    </>
  );
}
