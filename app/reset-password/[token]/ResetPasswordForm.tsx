"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { updatePassword } from "./actions";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
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
  FieldLabel,
  FieldError as FormMessage,
} from "@/components/ui/field";
import { Controller } from "react-hook-form";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

const resetPasswordSchema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

interface ResetPasswordFormProps {
  token: string;
}

export default function ResetPasswordForm({ token }: ResetPasswordFormProps) {
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
          { duration: 5000 }
        );
        router.push("/login");
      }
    } catch {
      toast.error("An unexpected error occurred. Please try again.");
    }

    setIsLoading(false);
  }

  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <Card className="w-full max-w-sm mx-auto mb-12">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl">Set new password</CardTitle>
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
                  <FieldLabel htmlFor={field.name}>New Password</FieldLabel>
                  <Input
                    id={field.name}
                    type="password"
                    placeholder="Enter your new password"
                    {...field}
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.invalid && <FormMessage errors={[fieldState.error]} />}
                  <div className="mt-3 space-y-2">
                    <div className="rounded-lg bg-[hsl(var(--warning)/0.15)] border border-[hsl(var(--warning)/0.4)] p-3 shadow-xs">
                      <p className="text-xs font-semibold text-[hsl(var(--warning))] dark:text-[hsl(var(--warning))] mb-2 flex items-center gap-2">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Password Requirements
                      </p>
                      <ul className="space-y-1.5 text-xs text-[hsl(var(--warning))] dark:text-[hsl(var(--warning))] opacity-90">
                        <li className="flex items-start gap-2">
                          <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          <span>At least 8 characters long</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          <span>Cannot be a commonly used or compromised password</span>
                        </li>
                      </ul>
                    </div>
                  </div>
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="confirmPassword"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>Confirm New Password</FieldLabel>
                  <Input
                    id={field.name}
                    type="password"
                    placeholder="Confirm your new password"
                    {...field}
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.invalid && <FormMessage errors={[fieldState.error]} />}
                </Field>
              )}
            />
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? "Setting New Password..." : "Set New Password"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
