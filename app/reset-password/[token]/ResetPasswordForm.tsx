"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { passwordSchema } from "@/lib/auth/password-policy";
import { updatePassword } from "./actions";
import { passwordRecoveryPath } from "../continuation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldDescription,
  FieldLabel,
  FieldError as FormMessage,
} from "@/components/ui/field";
import { Controller } from "react-hook-form";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

interface ResetPasswordFormProps {
  token: string;
  redirectPath?: string | null;
}

export default function ResetPasswordForm({
  token,
  redirectPath,
}: ResetPasswordFormProps) {
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      password: "",
      confirmPassword: "",
    },
  });

  async function onSubmit(data: ResetPasswordValues) {
    setIsLoading(true);

    try {
      const formData = new FormData();
      formData.append("password", data.password);
      formData.append("token", token);

      const result = await updatePassword(formData);

      if (result.error) {
        if (result.error.server) {
          toast.error(result.error.server[0]);
        }
        if (result.error.password) {
          form.setError("password", {
            type: "server",
            message: result.error.password[0],
          });
        }
      } else if (result.success) {
        toast.success(
          "Your password has been reset successfully. Please log in with your new password.",
          { duration: 5000 },
        );
        router.push(passwordRecoveryPath("/login", redirectPath));
      }
    } catch {
      toast.error("An unexpected error occurred. Please try again.");
    }

    setIsLoading(false);
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-12 sm:px-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-lg">Set new password</CardTitle>
          <CardDescription>
            Please enter your new password below.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <Controller
              control={form.control}
              name="password"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>New password</FieldLabel>
                  <Input
                    id={field.name}
                    type="password"
                    autoComplete="new-password"
                    placeholder="Enter your new password"
                    {...field}
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.invalid && (
                    <FormMessage errors={[fieldState.error]} />
                  )}
                  <FieldDescription>
                    At least 8 characters long. Cannot be a commonly used or
                    compromised password.
                  </FieldDescription>
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="confirmPassword"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>
                    Confirm new password
                  </FieldLabel>
                  <Input
                    id={field.name}
                    type="password"
                    autoComplete="new-password"
                    placeholder="Confirm your new password"
                    {...field}
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.invalid && (
                    <FormMessage errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? "Setting new password..." : "Set new password"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
