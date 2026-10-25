"use client";

import * as React from "react";

import { SectionHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/**
 * One step of the create flow: a section heading and a single sheet whose
 * groups are separated by hairlines.
 */
export function StepSection({
  title,
  titleId,
  description,
  children,
}: {
  title: React.ReactNode;
  titleId?: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-4">
      <SectionHeader
        title={titleId ? <span id={titleId}>{title}</span> : title}
        description={description}
      />
      <Card className="divide-border gap-0 divide-y py-0">{children}</Card>
    </section>
  );
}

/** A group of related fields inside a step, under a small sub-heading. */
export function FormGroup({
  title,
  description,
  aside,
  className,
  children,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  aside?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("grid gap-5 p-4 sm:p-6", className)}>
      {title ? (
        <div className="grid gap-1">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-base leading-snug font-medium">{title}</h3>
            {aside}
          </div>
          {description ? (
            <p className="text-muted-foreground text-sm">{description}</p>
          ) : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** Label, control, helper text and error, in that order, with one rhythm. */
export function FormField({
  label,
  htmlFor,
  hint,
  description,
  error,
  errorId,
  className,
  children,
}: {
  label?: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  description?: React.ReactNode;
  error?: React.ReactNode;
  errorId?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Field
      data-invalid={error ? true : undefined}
      className={cn("gap-2", className)}
    >
      {label ? (
        <div className="flex items-baseline justify-between gap-3">
          <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
          {hint}
        </div>
      ) : null}
      {children}
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </Field>
  );
}

/** A setting you switch on or off: label and helper on the left, switch on the right. */
export function ToggleRow({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  id: string;
  label: React.ReactNode;
  description?: React.ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Field orientation="horizontal" className="min-h-9 gap-4">
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {description ? (
          <FieldDescription>{description}</FieldDescription>
        ) : null}
      </FieldContent>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
    </Field>
  );
}

/** The visible dot for a native radio that is itself screen-reader only. */
export function OptionRadioDot({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "border-input dark:bg-input/30 flex size-4 items-center justify-center rounded-full border",
        selected && "border-primary",
      )}
    >
      {selected ? <span className="bg-primary size-2 rounded-full" /> : null}
    </span>
  );
}

/**
 * The one look for every "pick one" choice in the flow: event type, tracking,
 * check-in method and visibility. The radio sits on the left edge, the title
 * and an optional label badge share the first line, and the description lines
 * up under the title.
 */
export function OptionCard({
  htmlFor,
  control,
  selected,
  disabled,
  invalid,
  title,
  titleId,
  titleAs: TitleTag = "span",
  description,
  descriptionId,
  badge,
  children,
}: {
  htmlFor?: string;
  control: React.ReactNode;
  selected: boolean;
  disabled?: boolean;
  invalid?: boolean;
  title: string;
  titleId?: string;
  titleAs?: "span" | "h3";
  description: React.ReactNode;
  descriptionId?: string;
  badge?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      data-selected={selected ? "" : undefined}
      className={cn(
        "has-focus-visible:border-ring has-focus-visible:ring-ring/50 flex items-start gap-3 rounded-lg border p-3 transition-colors has-focus-visible:ring-[3px] sm:p-4",
        selected ? "border-primary bg-primary/5" : "hover:bg-muted/50",
        invalid && !selected && "border-destructive",
        disabled
          ? "cursor-not-allowed opacity-60 hover:bg-transparent"
          : "cursor-pointer",
      )}
    >
      <span className="flex h-5 shrink-0 items-center">{control}</span>
      <span className="grid min-w-0 flex-1 gap-1">
        <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <TitleTag id={titleId} className="text-sm leading-5 font-medium">
            {title}
          </TitleTag>
          {badge}
        </span>
        <span
          id={descriptionId}
          className="text-muted-foreground block text-sm"
        >
          {description}
        </span>
        {children}
      </span>
    </label>
  );
}
