"use client";
import { safeConsole } from "@/lib/safe-console";


import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CircleCheck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { SettingsSection } from "@/components/layout/SettingsSection";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import type { UserProfile } from "@/hooks/useUserProfile";
import { cn } from "@/lib/utils";
import { removeProfilePicture, updateNameAndUsername } from "./actions";
import type { OnboardingValues } from "./actions";
import { AvatarField } from "./AvatarField";

const NAME_MAX_LENGTH = 64;
const USERNAME_MAX_LENGTH = 32;
const PHONE_LENGTH = 10; // raw digits
const USERNAME_REGEX = /^[a-zA-Z0-9_.-]+$/;
const PHONE_REGEX = /^\d{3}-\d{3}-\d{4}$/; // XXX-XXX-XXXX
const FORM_ID = "profile-form";

const onboardingSchema = z.object({
  fullName: z
    .string()
    .min(3, "Full name must be at least 3 characters")
    .max(
      NAME_MAX_LENGTH,
      `Full name cannot exceed ${NAME_MAX_LENGTH} characters`,
    )
    .optional()
    .or(z.literal("").transform(() => undefined)),
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(
      USERNAME_MAX_LENGTH,
      `Username cannot exceed ${USERNAME_MAX_LENGTH} characters`,
    )
    .regex(
      USERNAME_REGEX,
      "Username can only contain letters, numbers, underscores, dots and hyphens",
    )
    .transform((val) => val.toLowerCase())
    .optional()
    .or(z.literal("").transform(() => undefined)),
  avatarUrl: z.string().nullable().optional(),
  phoneNumber: z
    .string()
    .refine(
      (val) => !val || val === "" || PHONE_REGEX.test(val),
      "Phone number must be in format XXX-XXX-XXXX",
    )
    .transform((val) => {
      if (!val || val === "") return undefined;
      // Store digits only.
      return val.replace(/\D/g, "");
    })
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

const EMPTY_VALUES: OnboardingValues = {
  fullName: "",
  username: "",
  avatarUrl: undefined,
  phoneNumber: undefined,
};

function formatPhoneNumber(value: string): string {
  if (!value) return value;
  const digits = value.replace(/[^\d]/g, "");
  if (digits.length < 4) return digits;
  if (digits.length < 7) {
    return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  }
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}

function Counter({ current, max }: { current: number; max: number }) {
  return (
    <span
      className={cn(
        "text-xs tabular-nums",
        current > max
          ? "text-destructive font-medium"
          : "text-muted-foreground",
      )}
    >
      {current}/{max}
    </span>
  );
}

interface ProfileFormProps {
  profile: UserProfile | null;
  isProfileLoading: boolean;
  isDataLoading: boolean;
}

/** Photo, name, username and phone. The one explicit save on the page. */
export function ProfileForm({
  profile,
  isProfileLoading,
  isDataLoading,
}: ProfileFormProps) {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(
    null,
  );
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [defaultValues, setDefaultValues] =
    useState<OnboardingValues>(EMPTY_VALUES);

  const form = useForm<OnboardingValues>({
    resolver: zodResolver(onboardingSchema),
    defaultValues,
    values: defaultValues,
  });

  useEffect(() => {
    if (isProfileLoading) {
      return;
    }

    if (!profile) {
      setDefaultValues(EMPTY_VALUES);
      form.reset(EMPTY_VALUES);
      return;
    }

    const formattedPhoneNumber = profile.phone
      ? `${profile.phone.substring(0, 3)}-${profile.phone.substring(3, 6)}-${profile.phone.substring(6, 10)}`
      : undefined;

    const profileValues: OnboardingValues = {
      fullName: profile.full_name ?? undefined,
      username: profile.username ?? undefined,
      avatarUrl: profile.avatar_url ?? undefined,
      phoneNumber: formattedPhoneNumber,
    };

    setDefaultValues(profileValues);
    form.reset(profileValues);
  }, [profile, isProfileLoading, form]);

  async function handleUsernameBlur(e: React.FocusEvent<HTMLInputElement>) {
    const username = e.target.value.trim();
    if (username.length < 3) {
      setUsernameAvailable(null);
      return;
    }
    setCheckingUsername(true);
    const res = await fetch(
      `/api/check-username?username=${encodeURIComponent(username)}`,
    );
    const data = await res.json();
    setUsernameAvailable(data.available);
    setCheckingUsername(false);
  }

  async function onSubmit(data: OnboardingValues) {
    setIsSaving(true);

    try {
      const result = await updateNameAndUsername(
        data.fullName,
        data.username,
        data.phoneNumber, // digits only after the schema transform
      );

      if (!result) {
        toast.error("Failed to update profile. Please try again.");
        return;
      }

      if (result.error) {
        const errors = result.error;
        type FormErrorKey = keyof OnboardingValues | "root.serverError";
        Object.keys(errors).forEach((key) => {
          const formKey =
            key === "server"
              ? "root.serverError"
              : (key as keyof OnboardingValues);
          if (
            formKey in form.getValues() ||
            formKey === "root.serverError" ||
            formKey === "phoneNumber"
          ) {
            form.setError(formKey as FormErrorKey, {
              type: "server",
              message: errors[key as keyof typeof errors]?.[0],
            });
          } else {
            safeConsole.warn(`Unexpected error key from server: ${key}`);
            form.setError("root.serverError", {
              type: "server",
              message: "An unexpected validation error occurred.",
            });
          }
        });
        toast.error("Failed to update profile. Please check the errors.");
      } else {
        toast.success("Profile updated successfully!");
        setTimeout(() => {
          router.refresh();
        }, 1000);
      }
    } catch (error) {
      safeConsole.error("Error updating profile:", error);
      toast.error("An unexpected error occurred. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }

  const handleRemoveAvatar = async () => {
    const result = await removeProfilePicture();
    if (result.error) {
      toast.error("Failed to remove profile picture");
      return;
    }
    form.setValue("avatarUrl", undefined, { shouldDirty: true });
    setDefaultValues((prev) => ({ ...prev, avatarUrl: undefined }));
    toast.success("Profile picture removed successfully");
    setTimeout(() => {
      router.refresh();
    }, 1000);
  };

  const serverError = form.formState.errors.root?.serverError;

  return (
    <SettingsSection
      title="Public profile"
      description="Your photo and details as other people see them."
      footerHint="Username: letters, numbers, . _ -"
      footer={
        <Button
          type="submit"
          form={FORM_ID}
          disabled={isDataLoading || isSaving || !form.formState.isDirty}
          className="w-full sm:w-auto"
        >
          {isSaving ? "Saving changes..." : "Save changes"}
        </Button>
      }
    >
      {isDataLoading ? (
        <div className="grid gap-6">
          <div className="flex items-center gap-4">
            <Skeleton className="size-16 rounded-full" />
            <Skeleton className="h-9 w-40" />
          </div>
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : (
        <form id={FORM_ID} onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup className="gap-5">
            <Controller
              control={form.control}
              name="avatarUrl"
              render={({ field }) => (
                <AvatarField
                  url={typeof field.value === "string" ? field.value : ""}
                  fullName={form.watch("fullName")}
                  onUpload={(url) => field.onChange(url)}
                  onRemove={handleRemoveAvatar}
                />
              )}
            />
            <Separator />
            <Controller
              control={form.control}
              name="fullName"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <div className="flex items-baseline justify-between gap-2">
                    <FieldLabel htmlFor={field.name}>Full name</FieldLabel>
                    <Counter
                      current={(field.value ?? "").length}
                      max={NAME_MAX_LENGTH}
                    />
                  </div>
                  <Input
                    id={field.name}
                    placeholder="Enter your full name"
                    {...field}
                    value={field.value ?? ""}
                    maxLength={NAME_MAX_LENGTH}
                    aria-invalid={fieldState.invalid}
                  />
                  <FieldDescription>
                    Your full name as you&apos;d like others to see it.
                  </FieldDescription>
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="username"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <div className="flex items-baseline justify-between gap-2">
                    <FieldLabel htmlFor={field.name}>Username</FieldLabel>
                    <Counter
                      current={(field.value ?? "").length}
                      max={USERNAME_MAX_LENGTH}
                    />
                  </div>
                  <InputGroup>
                    <InputGroupAddon>
                      <InputGroupText>@</InputGroupText>
                    </InputGroupAddon>
                    <InputGroupInput
                      id={field.name}
                      placeholder="username"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      {...field}
                      value={field.value ?? ""}
                      maxLength={USERNAME_MAX_LENGTH}
                      onChange={(e) => {
                        const lower = e.target.value
                          .replace(/\s/g, "")
                          .toLowerCase();
                        field.onChange(lower);
                        if (form.formState.errors.username) {
                          form.clearErrors("username");
                        }
                        setUsernameAvailable(null);
                      }}
                      onBlur={(e) => {
                        field.onBlur();
                        handleUsernameBlur(e);
                      }}
                      aria-invalid={
                        fieldState.invalid ||
                        Boolean(
                          field.value && !USERNAME_REGEX.test(field.value),
                        )
                      }
                    />
                    {checkingUsername ? (
                      <InputGroupAddon align="inline-end">
                        <Spinner aria-label="Checking username" />
                      </InputGroupAddon>
                    ) : usernameAvailable !== null ? (
                      <InputGroupAddon align="inline-end">
                        {usernameAvailable ? (
                          <CircleCheck
                            className="text-success"
                            aria-label="Username is available"
                          />
                        ) : (
                          <XCircle
                            className="text-destructive"
                            aria-label="Username is taken"
                          />
                        )}
                      </InputGroupAddon>
                    ) : null}
                  </InputGroup>
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="phoneNumber"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <div className="flex items-baseline justify-between gap-2">
                    <FieldLabel htmlFor={field.name}>
                      Phone number (optional)
                    </FieldLabel>
                    <Counter
                      current={(field.value ?? "").replace(/\D/g, "").length}
                      max={PHONE_LENGTH}
                    />
                  </div>
                  <Input
                    id={field.name}
                    type="tel"
                    placeholder="XXX-XXX-XXXX"
                    {...field}
                    value={field.value || ""}
                    onChange={(e) =>
                      field.onChange(formatPhoneNumber(e.target.value))
                    }
                    maxLength={12} // XXX-XXX-XXXX
                    aria-invalid={fieldState.invalid}
                  />
                  <FieldDescription>
                    Your 10-digit number. Used to contact you when you sign up
                    for or create projects.
                  </FieldDescription>
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
            {serverError?.message && (
              <FieldError>{serverError.message}</FieldError>
            )}
          </FieldGroup>
        </form>
      )}
    </SettingsSection>
  );
}
