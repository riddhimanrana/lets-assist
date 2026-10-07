"use client";
import { safeConsole } from "@/lib/safe-console";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { passwordSchema } from "@/lib/auth/password-policy";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel, FieldError } from "@/components/ui/field";
import { Controller } from "react-hook-form";
import { toast } from "sonner";
import { motion } from "motion/react";
import {
  setPasswordAction,
  updateEmailAction,
  updatePasswordAction,
} from "./actions";
import { useAuth } from "@/hooks/useAuth";
import { createClient } from "@/lib/supabase/client";
import AccountDeletionSection from "./AccountDeletionSection";
import DataExportSection from "./DataExportSection";

const updatePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, "Please confirm your new password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "New passwords don't match",
    path: ["confirmPassword"],
  });
type UpdatePasswordValues = z.infer<typeof updatePasswordSchema>;

const setPasswordSchema = z
  .object({
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });
type SetPasswordValues = z.infer<typeof setPasswordSchema>;

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

export default function SecurityClient() {
  const { user } = useAuth(); // Use centralized auth hook
  const [currentEmail, setCurrentEmail] = useState("");
  const [isPasswordLoading, setIsPasswordLoading] = useState(false);
  const [isEmailLoading, setIsEmailLoading] = useState(false);
  // OAuth detection state
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [oauthProvider, setOauthProvider] = useState<string | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  const passwordForm = useForm<UpdatePasswordValues>({
    resolver: zodResolver(updatePasswordSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  const setPasswordForm = useForm<SetPasswordValues>({
    resolver: zodResolver(setPasswordSchema),
    defaultValues: {
      newPassword: "",
      confirmPassword: "",
    },
  });

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

  // Check OAuth authentication methods
  useEffect(() => {
    async function checkAuthMethods() {
      if (!user) {
        setHasPassword(false);
        setOauthProvider(null);
        setIsCheckingAuth(false);
        return;
      }

      setIsCheckingAuth(true);
      const supabase = createClient();

      try {
        const [{ data: identitiesData }, { data: userData }] =
          await Promise.all([
            supabase.auth.getUserIdentities(),
            supabase.auth.getUser(),
          ]);

        const identities =
          identitiesData?.identities ?? userData?.user?.identities ?? [];
        const providersFromIdentities = identities
          .map((identity) => identity.provider)
          .filter(Boolean);
        const providersFromMetadata =
          (userData?.user?.app_metadata?.providers as string[] | undefined) ??
          [];
        const primaryProvider = userData?.user?.app_metadata?.provider as
          string | undefined;

        const hasEmailProvider =
          providersFromIdentities.includes("email") ||
          providersFromMetadata.includes("email") ||
          primaryProvider === "email";

        const oauthProviderFromIdentities = providersFromIdentities.find(
          (provider) => provider !== "email",
        );
        const oauthProviderFromMetadata = providersFromMetadata.find(
          (provider) => provider !== "email",
        );
        const oauthProviderFromPrimary =
          primaryProvider && primaryProvider !== "email"
            ? primaryProvider
            : null;

        setHasPassword(hasEmailProvider);
        setOauthProvider(
          oauthProviderFromIdentities ||
            oauthProviderFromMetadata ||
            oauthProviderFromPrimary ||
            null,
        );
      } catch (error) {
        safeConsole.error("Error checking auth methods:", error);
      } finally {
        setIsCheckingAuth(false);
      }
    }

    checkAuthMethods();
  }, [user]);

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

  const handlePasswordChange = async (data: UpdatePasswordValues) => {
    setIsPasswordLoading(true);
    const formData = new FormData();
    formData.append("currentPassword", data.currentPassword);
    formData.append("newPassword", data.newPassword);
    formData.append("confirmPassword", data.confirmPassword);

    const result = await updatePasswordAction(formData);

    if (result.error) {
      if (result.error.server) {
        toast.error(result.error.server[0]);
      }
      if (result.error.currentPassword) {
        passwordForm.setError("currentPassword", {
          type: "server",
          message: result.error.currentPassword[0],
        });
      }
      if (result.error.newPassword) {
        passwordForm.setError("newPassword", {
          type: "server",
          message: result.error.newPassword[0],
        });
      }
      if (result.error.confirmPassword) {
        passwordForm.setError("confirmPassword", {
          type: "server",
          message: result.error.confirmPassword[0],
        });
      }
    } else if (result.success) {
      toast.success("Password updated successfully!");
      passwordForm.reset();
    }
    setIsPasswordLoading(false);
  };

  const handleSetPassword = async (data: SetPasswordValues) => {
    setIsPasswordLoading(true);
    const formData = new FormData();
    formData.append("newPassword", data.newPassword);
    formData.append("confirmPassword", data.confirmPassword);

    const result = await setPasswordAction(formData);

    if (result.error) {
      if (result.error.server) {
        toast.error(result.error.server[0]);
      }
      if (result.error.newPassword) {
        setPasswordForm.setError("newPassword", {
          type: "server",
          message: result.error.newPassword[0],
        });
      }
      if (result.error.confirmPassword) {
        setPasswordForm.setError("confirmPassword", {
          type: "server",
          message: result.error.confirmPassword[0],
        });
      }
    } else if (result.success) {
      toast.success(
        "Password set successfully! You can now use email/password to sign in.",
      );
      setPasswordForm.reset();
      // After setting password, user now has password auth capability
      // Note: OAuth users who set a password don't get an "email" identity provider
      // They still only have their OAuth identity, but can now also sign in with password
      setHasPassword(true);
    }
    setIsPasswordLoading(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 sm:p-6"
    >
      <div className="max-w-6xl">
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Privacy & Security
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage your email, password, and account security
          </p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          <Card className="flex flex-col h-full">
            <CardHeader className="">
              <CardTitle className="text-xl">Login Email</CardTitle>
              <CardDescription>
                Change the email address you use to sign in
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1">
              <form
                onSubmit={emailForm.handleSubmit(handleEmailChange)}
                className="space-y-4"
              >
                <Field>
                  <FieldLabel htmlFor="current-email">Current Email</FieldLabel>
                  <Input
                    id="current-email"
                    type="email"
                    value={currentEmail}
                    disabled
                    readOnly
                  />
                </Field>
                <Controller
                  control={emailForm.control}
                  name="newEmail"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={field.name}>New Email</FieldLabel>
                      <Input
                        id={field.name}
                        type="email"
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
                      <FieldLabel htmlFor={field.name}>
                        Confirm New Email
                      </FieldLabel>
                      <Input
                        id={field.name}
                        type="email"
                        placeholder="Confirm new email"
                        {...field}
                        aria-invalid={fieldState.invalid}
                      />
                      <FieldError errors={[fieldState.error]} />
                    </Field>
                  )}
                />
                <Button
                  type="submit"
                  disabled={isEmailLoading}
                  className="w-full sm:w-auto"
                >
                  {isEmailLoading ? "Updating..." : "Update Email"}
                </Button>
              </form>
            </CardContent>
          </Card>
          <Card className="flex flex-col h-full">
            <CardHeader className="">
              <CardTitle className="text-xl">
                {hasPassword ? "Password" : "Set Password"}
              </CardTitle>
              <CardDescription>
                {hasPassword
                  ? "Change your current password"
                  : `You signed in with ${oauthProvider || "OAuth"}. Set a password to enable email/password login.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1">
              {isCheckingAuth ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
              ) : hasPassword ? (
                <form
                  onSubmit={passwordForm.handleSubmit(handlePasswordChange)}
                  className="space-y-4"
                >
                  <Controller
                    control={passwordForm.control}
                    name="currentPassword"
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor="update-current-password">
                          Current Password
                        </FieldLabel>
                        <Input
                          id="update-current-password"
                          type="password"
                          autoComplete="current-password"
                          placeholder="Enter current password"
                          {...field}
                          aria-invalid={fieldState.invalid}
                        />
                        <FieldError errors={[fieldState.error]} />
                      </Field>
                    )}
                  />
                  <Controller
                    control={passwordForm.control}
                    name="newPassword"
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor="update-new-password">
                          New Password
                        </FieldLabel>
                        <Input
                          id="update-new-password"
                          type="password"
                          autoComplete="new-password"
                          placeholder="Enter new password"
                          {...field}
                          aria-invalid={fieldState.invalid}
                        />
                        <FieldError errors={[fieldState.error]} />
                      </Field>
                    )}
                  />

                  <div className="rounded-lg bg-warning/15 border border-warning/40 p-3 shadow-xs">
                    <p className="text-xs font-semibold text-warning mb-2 flex items-center gap-2">
                      <AlertCircle className="h-3.5 w-3.5" />
                      Password Requirements
                    </p>
                    <ul className="space-y-1.5 text-xs text-warning opacity-90">
                      <li className="flex items-start gap-2">
                        <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        <span>At least 8 characters long</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        <span>
                          Cannot be a commonly used or compromised password
                        </span>
                      </li>
                    </ul>
                  </div>

                  <Controller
                    control={passwordForm.control}
                    name="confirmPassword"
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor="update-confirm-password">
                          Confirm New Password
                        </FieldLabel>
                        <Input
                          id="update-confirm-password"
                          type="password"
                          autoComplete="new-password"
                          placeholder="Confirm new password"
                          {...field}
                          aria-invalid={fieldState.invalid}
                        />
                        <FieldError errors={[fieldState.error]} />
                      </Field>
                    )}
                  />
                  <Button
                    type="submit"
                    disabled={isPasswordLoading}
                    className="w-full sm:w-auto"
                  >
                    {isPasswordLoading ? "Updating..." : "Update Password"}
                  </Button>
                </form>
              ) : (
                <form
                  onSubmit={setPasswordForm.handleSubmit(handleSetPassword)}
                  className="space-y-4"
                >
                  <Controller
                    control={setPasswordForm.control}
                    name="newPassword"
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor="set-new-password">
                          New Password
                        </FieldLabel>
                        <Input
                          id="set-new-password"
                          type="password"
                          autoComplete="new-password"
                          placeholder="Enter new password"
                          {...field}
                          aria-invalid={fieldState.invalid}
                        />
                        <FieldError errors={[fieldState.error]} />
                      </Field>
                    )}
                  />

                  <div className="rounded-lg bg-warning/15 border border-warning/40 p-3 shadow-xs">
                    <p className="text-xs font-semibold text-warning mb-2 flex items-center gap-2">
                      <AlertCircle className="h-3.5 w-3.5" />
                      Password Requirements
                    </p>
                    <ul className="space-y-1.5 text-xs text-warning opacity-90">
                      <li className="flex items-start gap-2">
                        <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        <span>At least 8 characters long</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        <span>
                          Cannot be a commonly used or compromised password
                        </span>
                      </li>
                    </ul>
                  </div>

                  <Controller
                    control={setPasswordForm.control}
                    name="confirmPassword"
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor="set-confirm-password">
                          Confirm New Password
                        </FieldLabel>
                        <Input
                          id="set-confirm-password"
                          type="password"
                          autoComplete="new-password"
                          placeholder="Confirm new password"
                          {...field}
                          aria-invalid={fieldState.invalid}
                        />
                        <FieldError errors={[fieldState.error]} />
                      </Field>
                    )}
                  />
                  <Button
                    type="submit"
                    disabled={isPasswordLoading}
                    className="w-full sm:w-auto"
                  >
                    {isPasswordLoading ? "Setting..." : "Set Password"}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
        <DataExportSection />

        <AccountDeletionSection />
      </div>
    </motion.div>
  );
}
