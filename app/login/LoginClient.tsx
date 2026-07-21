"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { applyPostLoginAffiliations, signInWithGoogle } from "./actions";
import { SecureCheckLoading } from "@/components/auth/SecureCheckLoading";
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
  inviteToken?: string;
  prefilledEmail?: string;
}

export default function LoginClient({
  redirectPath,
  staffToken,
  orgUsername,
  inviteToken,
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

      const isBypassToken = turnstileToken === "turnstile-bypass";
      const { data: authData, error } = await supabase.auth.signInWithPassword({
        email: data.email,
        password: data.password,
        options: (turnstileToken && !isBypassToken) ? { captchaToken: turnstileToken } : undefined,
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

      const affiliationResult = await applyPostLoginAffiliations(
        staffToken,
        orgUsername,
      );

      // Handle generic invite token (newer flow)
      if (inviteToken) {
        const inviteParams = new URLSearchParams({ token: inviteToken });
        if (orgUsername) inviteParams.set("org", orgUsername);
        finalRedirectUrl = `/organization/join/invite?${inviteParams.toString()}`;
      }
      // Handle staff token (legacy flow)
      else if (affiliationResult.inviteOutcome) {
        const inviteOutcome = affiliationResult.inviteOutcome;

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
            "Supabase appears unreachable from the browser. If you are using local development, start the stack with `bun run supabase` or `bun run supabase:start` and make sure Docker is running.",
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
    <section className="relative isolate flex min-h-[calc(100svh-4.5rem)] items-center justify-center overflow-hidden bg-background px-4 py-14 shadow-[inset_0_1px_0_hsl(var(--border))] sm:px-6 lg:px-8">

      <Card className="relative mx-auto w-full max-w-[410px] gap-0 overflow-hidden rounded-2xl border border-border/70 bg-card/95 py-0 shadow-[0_16px_44px_rgba(0,0,0,0.12),0_1px_6px_rgba(0,0,0,0.04)] ring-0 backdrop-blur-xl">
        <CardHeader className="space-y-2 px-6 pt-7 pb-0 sm:px-7">
          <CardTitle className="text-2xl font-semibold tracking-tight">
            Login
          </CardTitle>
          <CardDescription className="text-sm leading-5">
            {redirectPath
              ? "Login to continue to the requested page"
              : "Enter your email below to login to your account"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 p-6 sm:p-7">
          <form method="post" onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <Button
              type="button"
              variant="outline"
              className="h-10 w-full rounded-full border-border/80 bg-background/80 font-semibold shadow-xs hover:border-primary/30 hover:bg-primary/5"
              onClick={handleGoogleSignIn}
              disabled={isGoogleLoading}
            >
              {isGoogleLoading ? (
                "Connecting..."
              ) : (
                <>
                  <Image
                    src="/resources/google-logo-2026.png"
                    alt=""
                    width={18}
                    height={18}
                    className="mr-2 h-4.5 w-4.5 object-contain"
                  />
                  Login with Google
                </>
              )}
            </Button>

            <div className="relative py-1">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border/80" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-3 font-semibold tracking-wide text-muted-foreground/80">
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
                    <FieldLabel htmlFor={field.name} className="text-[13px] font-semibold">
                      Email
                    </FieldLabel>
                    <Input
                      id={field.name}
                      placeholder="m@example.com"
                      {...field}
                      aria-invalid={fieldState.invalid}
                      className="h-11 rounded-xl border-border/80 bg-muted/35 px-4 shadow-none focus-visible:bg-background"
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
                      <FieldLabel htmlFor={field.name} className="text-[13px] font-semibold">
                        Password
                      </FieldLabel>
                      <Link
                        href="/reset-password"
                        className="text-xs font-semibold text-muted-foreground transition-colors hover:text-primary"
                      >
                        Forgot your password?
                      </Link>
                    </div>
                    <Input
                      id={field.name}
                      type="password"
                      {...field}
                      aria-invalid={fieldState.invalid}
                      className="h-11 rounded-xl border-border/80 bg-muted/35 px-4 shadow-none focus-visible:bg-background"
                    />
                    <FieldError errors={[fieldState.error]} />
                  </Field>
                )}
              />

              <div className="flex justify-center">
                <div className="relative flex h-16.25 w-full max-w-75 items-center justify-center overflow-hidden rounded-xl border border-border/70 bg-background">
                  {!turnstileReady && <SecureCheckLoading />}
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

              <Button
                type="submit"
                className="h-10 w-full rounded-full bg-primary font-semibold text-primary-foreground shadow-none hover:bg-primary/90"
                disabled={isLoading}
              >
                {isLoading ? "Logging in..." : "Login"}
              </Button>
            </div>

            <div className="pt-1 text-center text-sm text-muted-foreground">
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
                className="font-semibold text-primary underline underline-offset-2 hover:text-primary/80"
              >
                Sign up
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}
