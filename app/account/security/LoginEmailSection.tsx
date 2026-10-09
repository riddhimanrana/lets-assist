"use client";

import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import { SettingsSection } from "@/components/layout/SettingsSection";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { updateEmailAction } from "./actions";

const updateEmailSchema = z
  .object({
    newEmail: z
      .string()
      .min(1, "Email is required")
      .email("Must be a valid email address")
      .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Must be a valid email format")
      .refine((email) => email.includes("@"), "Email must contain @ symbol"),
    confirmEmail: z
      .string()
      .min(1, "Please confirm your email")
      .email("Must be a valid email address")
      .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Must be a valid email format"),
  })
  .refine((data) => data.newEmail === data.confirmEmail, {
    message: "Email addresses don't match",
    path: ["confirmEmail"],
  });
type UpdateEmailValues = z.infer<typeof updateEmailSchema>;

const FORM_ID = "login-email-form";

export function LoginEmailSection() {
  const { user } = useAuth();
  const [currentEmail, setCurrentEmail] = useState("");
  const [isEmailLoading, setIsEmailLoading] = useState(false);

  const emailForm = useForm<UpdateEmailValues>({
    resolver: zodResolver(updateEmailSchema),
    defaultValues: {
      newEmail: "",
      confirmEmail: "",
    },
  });

  // Use cached user email instead of fetching
  useEffect(() => {
    if (user?.email) {
      setCurrentEmail(user.email);
    }
  }, [user?.email]);

  const handleEmailChange = async (data: UpdateEmailValues) => {
    setIsEmailLoading(true);
    const formData = new FormData();
    formData.append("newEmail", data.newEmail);
    formData.append("confirmEmail", data.confirmEmail);

    const result = await updateEmailAction(formData);

    if (result.error) {
      if (result.error.server) {
        toast.error(result.error.server[0]);
      }
      if (result.error.newEmail) {
        emailForm.setError("newEmail", {
          type: "server",
          message: result.error.newEmail[0],
        });
      }
      if (result.error.confirmEmail) {
        emailForm.setError("confirmEmail", {
          type: "server",
          message: result.error.confirmEmail[0],
        });
      }
    } else if (result.success) {
      toast.success(result.message || "Email update initiated successfully!");
      emailForm.reset();
    }
    setIsEmailLoading(false);
  };

  return (
    <SettingsSection
      title="Sign-in email"
      description="The email address you use to sign in."
      footerHint="We will send a confirmation link to the new address."
      footer={
        <Button
          type="submit"
          form={FORM_ID}
          disabled={isEmailLoading || !emailForm.formState.isDirty}
        >
          {isEmailLoading ? "Updating..." : "Update email"}
        </Button>
      }
    >
      <form
        id={FORM_ID}
        onSubmit={emailForm.handleSubmit(handleEmailChange)}
        className="grid gap-4"
      >
        <div className="grid gap-1">
          <p className="text-muted-foreground text-sm">Current email</p>
          {currentEmail ? (
            <p id="current-email" className="text-sm font-medium break-all">
              {currentEmail}
            </p>
          ) : (
            <Skeleton className="h-5 w-48" />
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 sm:items-start">
          <Controller
            control={emailForm.control}
            name="newEmail"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={field.name}>New email</FieldLabel>
                <Input
                  id={field.name}
                  type="email"
                  autoComplete="email"
                  placeholder="Enter new email"
                  {...field}
                  aria-invalid={fieldState.invalid}
                />
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
          <Controller
            control={emailForm.control}
            name="confirmEmail"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={field.name}>Confirm new email</FieldLabel>
                <Input
                  id={field.name}
                  type="email"
                  autoComplete="email"
                  placeholder="Confirm new email"
                  {...field}
                  aria-invalid={fieldState.invalid}
                />
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
        </div>
      </form>
    </SettingsSection>
  );
}
