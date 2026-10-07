"use client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { requestPasswordReset } from "./actions";
import { normalizeRedirectPath } from "@/app/signup/redirect-utils";
import { passwordRecoveryPath } from "./continuation";
import { Button, buttonVariants } from "@/components/ui/button";
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
import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { TurnstileComponent } from "@/components/ui/turnstile";
import { SecureCheckPanel } from "@/components/auth/SecureCheckPanel";
import { useBotVerification } from "@/hooks/useBotVerification";

const resetPasswordSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

interface ResetPasswordClientProps {
  error?: string;
  redirectPath?: string | null;
}

export default function ResetPasswordClient({
  error,
  redirectPath,
}: ResetPasswordClientProps) {
  const continuation = normalizeRedirectPath(redirectPath);
  const loginPath = passwordRecoveryPath("/login", continuation);
  const [isLoading, setIsLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const verification = useBotVerification({
    onError: () => {
      toast.error("Security verification failed. Please try again.");
    },
  });

  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      email: "",
    },
  });

  async function onSubmit(data: ResetPasswordValues) {
    const turnstileToken = verification.token;

    setIsLoading(true);
    const formData = new FormData();
    formData.append("email", data.email);
    if (continuation) formData.append("redirect", continuation);

    if (turnstileToken) {
      formData.append("turnstileToken", turnstileToken);
    }

    const result = await requestPasswordReset(formData);

    if (result.error) {
      if (result.error.email) {
        form.setError("email", {
          type: "server",
          message: result.error.email[0],
        });
      }
      if (result.error.server) {
        toast.error(result.error.server[0]);
      }
    } else {
      setEmailSent(true);
      form.reset();
    }

    setIsLoading(false);
    verification.reset();
  }

  if (emailSent) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4 py-12 sm:px-6">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="text-lg">Check your email</CardTitle>
            <CardDescription>
              If an account exists with that email address, we&apos;ve sent
              password reset instructions.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              The email should arrive within a few minutes. Please check your
              spam folder if you don&apos;t see it.
            </p>
            <div className="grid gap-2">
              <Link href={loginPath} className={buttonVariants()}>
                Back to login
              </Link>
              <Button variant="outline" onClick={() => setEmailSent(false)}>
                Try another email
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-12 sm:px-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-lg">Reset password</CardTitle>
          <CardDescription>
            Enter your email address and we&apos;ll send you a link to reset
            your password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <Controller
              control={form.control}
              name="email"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>Email</FieldLabel>
                  <Input
                    id={field.name}
                    type="email"
                    placeholder="m@example.com"
                    {...field}
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.invalid && (
                    <FormMessage errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
            <div className="flex justify-center">
              <SecureCheckPanel
                phase={verification.phase}
                onRetry={verification.retry}
                className="w-75 rounded-lg"
                fallbackClassName="w-75 rounded-lg"
              >
                <TurnstileComponent
                  key={verification.widgetKey}
                  ref={verification.ref}
                  onLoad={verification.onLoad}
                  onVerify={verification.onVerify}
                  onError={verification.onError}
                  onExpire={() => verification.reset()}
                />
              </SecureCheckPanel>
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? "Sending reset link..." : "Send reset link"}
            </Button>
            <p className="text-muted-foreground text-center text-sm">
              Remember your password?{" "}
              <Link
                href={loginPath}
                className="text-foreground underline underline-offset-4"
              >
                Sign in
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
