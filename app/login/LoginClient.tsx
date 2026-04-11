"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Shield } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { applyStaffInviteForCurrentUser, signInWithGoogle } from "./actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { TurnstileComponent, TurnstileRef } from "@/components/ui/turnstile";
import { resolvePostAuthRedirectPath } from "@/lib/auth/mfa";
import { buildStaffInviteRedirectPath } from "@/lib/organization/staff-invite-outcome";
import {
  getAccountAccessErrorCode,
  isAccountBlockedStatus,
  readAccountAccessFromMetadata,
} from "@/lib/auth/account-access";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
  turnstileToken: z.string().optional(),
});

type LoginValues = z.infer<typeof loginSchema>;

interface LoginClientProps {
  redirectPath?: string;
  staffToken?: string;
  orgUsername?: string;
  prefilledEmail?: string;
}

export default function LoginClient({
  redirectPath,
  staffToken,
  orgUsername,
  prefilledEmail,
}: LoginClientProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_turnstileVerified, setTurnstileVerified] = useState(false);
  const turnstileRef = useRef<TurnstileRef>(null);
  const [turnstileReady, setTurnstileReady] = useState(false);
  const normalizedPrefilledEmail = prefilledEmail?.trim() ?? "";

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: normalizedPrefilledEmail,
      password: "",
      turnstileToken: "",
    },
  });

  const searchParams = useSearchParams();
  const isVerified = searchParams.get("verified") === "true";
  const authError = searchParams.get("error");
  const authReason = searchParams.get("reason");

  const navigateAfterAuth = (path: string) => {
    // Use hard navigation to ensure the next request includes the freshest auth cookies.
    // This avoids SSR redirects caused by stale prefetched payloads right after sign-in.
    window.location.assign(path);
  };

  useEffect(() => {
    if (authError === "network-timeout") {
      toast.error("Connection issue while finishing sign-in. Please try again.");
      return;
    }

    if (authError === "account-banned") {
      toast.error("Your account has been banned.", {
        description:
          authReason || "If you think this is a mistake, contact support.",
      });
      return;
    }

    if (authError === "account-restricted") {
      toast.error("Your account is currently restricted.", {
        description: authReason || "Please contact support for assistance.",
      });
    }
  }, [authError, authReason]);

  async function onSubmit(data: LoginValues) {
    const turnstileToken = turnstileRef.current?.getResponse();

    setIsLoading(true);

    try {
      const supabase = createClient();

      const { data: authData, error } = await supabase.auth.signInWithPassword({
        email: data.email,
        password: data.password,
        options: turnstileToken ? { captchaToken: turnstileToken } : undefined,
      });

      if (error) {
        if (error.message.includes("captcha verification process failed")) {
          toast.error(
            "Security verification failed. Please complete the captcha again.",
          );
          turnstileRef.current?.reset();
          setTurnstileVerified(false);
        } else if (error.message.includes("provider")) {
          toast.error(
            "This email is registered with a different provider. Please sign in with that method.",
          );
        } else if (error.message.includes("Invalid login credentials")) {
          toast.error("Incorrect email or password.");
        } else {
          toast.error(error.message || "Login failed. Please try again.");
        }

        setIsLoading(false);
        turnstileRef.current?.reset();
        setTurnstileVerified(false);
        return;
      }

      const accessState = readAccountAccessFromMetadata(
        authData.user?.app_metadata ?? null,
      );

      if (isAccountBlockedStatus(accessState.status)) {
        await supabase.auth.signOut();

        const errorCode = getAccountAccessErrorCode(accessState.status);
        if (errorCode === "account-banned") {
          toast.error("Your account has been banned.", {
            description:
              accessState.reason ||
              "If you think this is a mistake, contact support.",
          });
        } else {
          toast.error("Your account is currently restricted.", {
            description:
              accessState.reason || "Please contact support for assistance.",
          });
        }

        turnstileRef.current?.reset();
        setTurnstileVerified(false);
        setIsLoading(false);
        return;
      }

      console.log("[LoginClient] Login successful, user:", authData.user?.email);

      const defaultRedirectUrl = isVerified
        ? "/home?confirmed=true"
        : resolvePostAuthRedirectPath(redirectPath);

      let finalRedirectUrl = defaultRedirectUrl;

      if (staffToken && orgUsername) {
        const inviteResult = await applyStaffInviteForCurrentUser(
          staffToken,
          orgUsername,
        );
        const inviteOutcome = inviteResult.inviteOutcome;

        if (inviteOutcome) {
          finalRedirectUrl = buildStaffInviteRedirectPath(inviteOutcome, {
            fallbackPath: defaultRedirectUrl,
          });
        }
      }

      navigateAfterAuth(finalRedirectUrl);
      return;
    } catch (error) {
      console.error("[LoginClient] Login error:", error);

      if (error instanceof TypeError && error.message.includes("Failed to fetch")) {
        toast.error("Cannot reach authentication service.", {
          description:
            "Supabase appears unreachable from the browser. If you use local Supabase, ensure Docker is running and start it with `bun run supabase:start`.",
        });
      } else {
        toast.error("An error occurred. Please try again.");
      }

      setIsLoading(false);
      turnstileRef.current?.reset();
      setTurnstileVerified(false);
    }
  }

  const handleGoogleSignIn = async () => {
    try {
      setIsGoogleLoading(true);

      const inviteContext = staffToken || orgUsername
        ? { staffToken, orgUsername }
        : null;

      const result = await signInWithGoogle(
        redirectPath ? resolvePostAuthRedirectPath(redirectPath) : null,
        inviteContext,
      );

      if (result.error) {
        if (result.error.server?.[0]?.includes("email-password")) {
          toast.error(
            "This email is registered with password. Please sign in with email and password.",
          );
        } else {
          toast.error("Failed to connect with Google. Please try again.");
        }
        return;
      }

      if (result.url) {
        window.location.href = result.url;
      }
    } catch {
      toast.error("An error occurred. Please try again.");
    } finally {
      setIsGoogleLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Card className="mx-auto mb-12 w-95 max-w-full py-0">
        <CardHeader className="px-6 pt-6 pb-0">
          <CardTitle className="text-2xl font-bold">Login</CardTitle>
          <CardDescription>
            {redirectPath
              ? "Login to continue to the requested page"
              : "Enter your email below to login to your account"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 p-6">
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={handleGoogleSignIn}
              disabled={isGoogleLoading}
            >
              {isGoogleLoading ? (
                "Connecting..."
              ) : (
                <>
                  <svg
                    className="mr-2 h-4 w-4"
                    aria-hidden="true"
                    focusable="false"
                    data-prefix="fab"
                    data-icon="google"
                    role="img"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 488 512"
                  >
                    <path
                      fill="currentColor"
                      d="M488 261.8C488 403.3 391.1 504 248 504 110.8 504 0 393.2 0 256S110.8 8 248 8c66.8 0 123 24.5 166.3 64.9l-67.5 64.9C258.5 52.6 94.3 116.6 94.3 256c0 86.5 69.1 156.6 153.7 156.6 98.2 0 135-70.4 140.8-106.9H248v-85.3h236.1c2.3 12.7 3.9 24.9 3.9 41.4z"
                    />
                  </svg>
                  Login with Google
                </>
              )}
            </Button>

            <div className="relative py-1">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 font-medium text-muted-foreground">
                  Or continue with
                </span>
              </div>
            </div>

            <div className="grid gap-4">
              <Controller
                control={form.control}
                name="email"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={field.name}>Email</FieldLabel>
                    <Input
                      id={field.name}
                      placeholder="m@example.com"
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
                    <div className="flex items-center justify-between">
                      <FieldLabel htmlFor={field.name}>Password</FieldLabel>
                      <Link
                        href="/reset-password"
                        className="text-xs font-medium text-muted-foreground/80 transition-colors hover:text-primary"
                      >
                        Forgot your password?
                      </Link>
                    </div>
                    <Input
                      id={field.name}
                      type="password"
                      {...field}
                      aria-invalid={fieldState.invalid}
                    />
                    <FieldError errors={[fieldState.error]} />
                  </Field>
                )}
              />

              <div className="flex justify-center">
                <div className="relative flex h-16.25 w-75 items-center justify-center overflow-hidden rounded-lg border border-border/50 bg-muted/30">
                  {!turnstileReady && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-lg bg-background/80 text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
                      <Shield className="h-4 w-4 text-muted-foreground/80" />
                      <span className="text-[0.7rem] font-semibold normal-case">
                        Bot verification loading…
                      </span>
                    </div>
                  )}
                  <TurnstileComponent
                    ref={turnstileRef}
                    onLoad={() => setTurnstileReady(true)}
                    onVerify={(token: string) => {
                      setTurnstileVerified(true);
                      form.setValue("turnstileToken", token);
                    }}
                    onError={() => {
                      setTurnstileVerified(false);
                      toast.error(
                        "Security verification failed. Please try again.",
                      );
                    }}
                    onExpire={() => {
                      setTurnstileVerified(false);
                      form.setValue("turnstileToken", "");
                    }}
                  />
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? "Logging in..." : "Login"}
              </Button>
            </div>

            <div className="mt-2 text-center text-sm text-muted-foreground">
              Don&apos;t have an account?{" "}
              <Link
                href={(() => {
                  const params = new URLSearchParams();

                  if (redirectPath) {
                    params.set("redirect", redirectPath);
                  }

                  if (staffToken) {
                    params.set("staff_token", staffToken);
                  }

                  if (orgUsername) {
                    params.set("org", orgUsername);
                  }

                  if (normalizedPrefilledEmail) {
                    params.set("email", normalizedPrefilledEmail);
                  }

                  const query = params.toString();
                  return query ? `/signup?${query}` : "/signup";
                })()}
                className="text-primary underline hover:text-primary/80"
              >
                Sign up
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
