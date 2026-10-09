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
import { cn } from "@/lib/utils";

// The same shell, card and control classes as the login and signup cards.
const AUTH_SHELL_CLASS =
  "relative isolate flex min-h-[calc(100svh-4.5rem)] items-center justify-center overflow-hidden bg-background px-4 py-14 sm:px-6 lg:px-8";
const AUTH_CARD_CLASS =
  "relative mx-auto w-full max-w-[410px] gap-0 overflow-hidden rounded-2xl py-0";
const AUTH_HEADER_CLASS = "space-y-2 px-6 pt-7 pb-0 sm:px-7";
const AUTH_BUTTON_CLASS = "h-10 w-full rounded-full font-semibold";

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
      <section className={AUTH_SHELL_CLASS}>
        <Card className={AUTH_CARD_CLASS}>
          <CardHeader className={AUTH_HEADER_CLASS}>
            <CardTitle>
              <h1 className="text-2xl font-semibold tracking-tight">
                Check your email
              </h1>
            </CardTitle>
            <CardDescription className="text-sm leading-5">
              If an account exists with that email address, we&apos;ve sent
              password reset instructions.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 p-6 sm:p-7">
            <p className="text-sm text-muted-foreground">
              The email should arrive within a few minutes. Please check your
              spam folder if you don&apos;t see it.
            </p>
            <div className="grid gap-2">
              <Link
                href={loginPath}
                className={cn(buttonVariants(), AUTH_BUTTON_CLASS)}
              >
                Back to login
              </Link>
              <Button
                variant="outline"
                className={AUTH_BUTTON_CLASS}
                onClick={() => setEmailSent(false)}
              >
                Try another email
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>
    );
  }

  return (
    <section className={AUTH_SHELL_CLASS}>
      <Card className={AUTH_CARD_CLASS}>
        <CardHeader className={AUTH_HEADER_CLASS}>
          <CardTitle>
            <h1 className="text-2xl font-semibold tracking-tight">
              Reset password
            </h1>
          </CardTitle>
          <CardDescription className="text-sm leading-5">
            Enter your email address and we&apos;ll send you a link to reset
            your password.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 p-6 sm:p-7">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <Controller
              control={form.control}
              name="email"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel
                    htmlFor={field.name}
                    className="text-[13px] font-semibold"
                  >
                    Email
                  </FieldLabel>
                  <Input
                    id={field.name}
                    type="email"
                    placeholder="m@example.com"
                    {...field}
                    aria-invalid={fieldState.invalid}
                    className="h-11 rounded-xl px-4"
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
                fallbackClassName="max-w-75"
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
            <Button
              type="submit"
              className={AUTH_BUTTON_CLASS}
              disabled={isLoading}
            >
              {isLoading ? "Sending reset link..." : "Send reset link"}
            </Button>
            <div className="text-muted-foreground pt-1 text-center text-sm">
              Remember your password?{" "}
              <Link
                href={loginPath}
                className="text-primary hover:text-primary/80 font-semibold underline underline-offset-2"
              >
                Login
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}
