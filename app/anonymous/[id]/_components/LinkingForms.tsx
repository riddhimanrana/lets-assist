"use client";

import type { FormEventHandler } from "react";
import { Controller, type UseFormReturn } from "react-hook-form";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

import type {
  CreateAccountValues,
  ExistingAccountValues,
} from "./linking-schemas";

export function ExistingAccountForm({
  form,
  onSubmit,
  disabled,
  isSubmitting,
}: {
  form: UseFormReturn<ExistingAccountValues>;
  onSubmit: FormEventHandler<HTMLFormElement>;
  disabled: boolean;
  isSubmitting: boolean;
}) {
  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <FieldGroup className="gap-4">
        <Controller
          control={form.control}
          name="email"
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={`existing-${field.name}`}>Email</FieldLabel>
              <Input
                id={`existing-${field.name}`}
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                {...field}
                aria-invalid={fieldState.invalid}
              />
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
        <Controller
          control={form.control}
          name="password"
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={`existing-${field.name}`}>
                Password
              </FieldLabel>
              <Input
                id={`existing-${field.name}`}
                type="password"
                autoComplete="current-password"
                placeholder="Enter your password"
                {...field}
                aria-invalid={fieldState.invalid}
              />
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
      </FieldGroup>
      <Button
        type="submit"
        className="w-full sm:w-auto sm:justify-self-start"
        disabled={disabled}
      >
        {isSubmitting && (
          <Spinner data-icon="inline-start" aria-hidden="true" />
        )}
        Sign in & link
      </Button>
    </form>
  );
}

export function CreateAccountForm({
  form,
  onSubmit,
  disabled,
  isSubmitting,
}: {
  form: UseFormReturn<CreateAccountValues>;
  onSubmit: FormEventHandler<HTMLFormElement>;
  disabled: boolean;
  isSubmitting: boolean;
}) {
  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <FieldGroup className="gap-4">
        <Controller
          control={form.control}
          name="fullName"
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={`create-${field.name}`}>
                Full name
              </FieldLabel>
              <Input
                id={`create-${field.name}`}
                autoComplete="name"
                placeholder="Your full name"
                {...field}
                aria-invalid={fieldState.invalid}
              />
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
        <Controller
          control={form.control}
          name="email"
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={`create-${field.name}`}>Email</FieldLabel>
              <Input
                id={`create-${field.name}`}
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                {...field}
                aria-invalid={fieldState.invalid}
              />
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
        <Controller
          control={form.control}
          name="password"
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={`create-${field.name}`}>Password</FieldLabel>
              <Input
                id={`create-${field.name}`}
                type="password"
                autoComplete="new-password"
                placeholder="Create a password"
                {...field}
                aria-invalid={fieldState.invalid}
              />
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
      </FieldGroup>
      <Button
        type="submit"
        className="w-full sm:w-auto sm:justify-self-start"
        disabled={disabled}
      >
        {isSubmitting && (
          <Spinner data-icon="inline-start" aria-hidden="true" />
        )}
        Create & link
      </Button>
    </form>
  );
}
