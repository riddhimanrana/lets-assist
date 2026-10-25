"use client";
import { safeConsole } from "@/lib/safe-console";

import { useEffect, useState } from "react";
import {
  Controller,
  useForm,
  type Control,
  type FieldPath,
  type FieldValues,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import { SettingsSection } from "@/components/layout/SettingsSection";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { passwordSchema } from "@/lib/auth/password-policy";
import { createClient } from "@/lib/supabase/client";
import { setPasswordAction, updatePasswordAction } from "./actions";

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

const FORM_ID = "password-form";

function PasswordField<Values extends FieldValues>({
  control,
  name,
  id,
  label,
  placeholder,
  autoComplete,
}: {
  control: Control<Values>;
  name: FieldPath<Values>;
  id: string;
  label: string;
  placeholder: string;
  autoComplete: "current-password" | "new-password";
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <Input
            id={id}
            type="password"
            autoComplete={autoComplete}
            placeholder={placeholder}
            {...field}
            aria-invalid={fieldState.invalid}
          />
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
}

function formatProviderName(provider: string | null) {
  if (!provider) {
    return "OAuth";
  }

  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

export function PasswordSection() {
  const { user } = useAuth();
  const [isPasswordLoading, setIsPasswordLoading] = useState(false);

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

  const isSettingFirstPassword = !isCheckingAuth && !hasPassword;
  const isDirty = isSettingFirstPassword
    ? setPasswordForm.formState.isDirty
    : passwordForm.formState.isDirty;

  return (
    <SettingsSection
      title={isSettingFirstPassword ? "Set a password" : "Password"}
      description={
        isSettingFirstPassword
          ? `You signed in with ${formatProviderName(oauthProvider)}. Set a password to enable email/password login.`
          : "Change your current password."
      }
      footerHint="At least 8 characters. Commonly used or compromised passwords are not accepted."
      footer={
        <Button
          type="submit"
          form={FORM_ID}
          disabled={isCheckingAuth || isPasswordLoading || !isDirty}
        >
          {isSettingFirstPassword
            ? isPasswordLoading
              ? "Setting..."
              : "Set password"
            : isPasswordLoading
              ? "Updating..."
              : "Update password"}
        </Button>
      }
    >
      {isCheckingAuth ? (
        <div className="grid gap-4" aria-busy="true">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : hasPassword ? (
        <form
          id={FORM_ID}
          onSubmit={passwordForm.handleSubmit(handlePasswordChange)}
          className="grid gap-4"
        >
          <PasswordField
            control={passwordForm.control}
            name="currentPassword"
            id="update-current-password"
            label="Current password"
            placeholder="Enter current password"
            autoComplete="current-password"
          />
          <div className="grid gap-4 sm:grid-cols-2 sm:items-start">
            <PasswordField
              control={passwordForm.control}
              name="newPassword"
              id="update-new-password"
              label="New password"
              placeholder="Enter new password"
              autoComplete="new-password"
            />
            <PasswordField
              control={passwordForm.control}
              name="confirmPassword"
              id="update-confirm-password"
              label="Confirm new password"
              placeholder="Confirm new password"
              autoComplete="new-password"
            />
          </div>
        </form>
      ) : (
        <form
          id={FORM_ID}
          onSubmit={setPasswordForm.handleSubmit(handleSetPassword)}
          className="grid gap-4"
        >
          <div className="grid gap-4 sm:grid-cols-2 sm:items-start">
            <PasswordField
              control={setPasswordForm.control}
              name="newPassword"
              id="set-new-password"
              label="New password"
              placeholder="Enter new password"
              autoComplete="new-password"
            />
            <PasswordField
              control={setPasswordForm.control}
              name="confirmPassword"
              id="set-confirm-password"
              label="Confirm new password"
              placeholder="Confirm new password"
              autoComplete="new-password"
            />
          </div>
        </form>
      )}
    </SettingsSection>
  );
}
