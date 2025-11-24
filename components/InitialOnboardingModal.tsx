'use client';

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { initialOnboardingSchema, InitialOnboardingValues } from "@/schemas/onboarding-schema";
import { useState, useEffect } from "react";
import { completeInitialOnboarding, checkUsernameAvailability } from "./onboarding-actions";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { CircleCheck, XCircle } from "lucide-react";

// Constants for validation - same as ProfileClient
const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 32;
const PHONE_LENGTH = 10; // For raw digits
const USERNAME_REGEX = /^[a-zA-Z0-9_.-]+$/;

interface InitialOnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  currentFullName?: string | null;
  currentEmail?: string | null;
}

export default function InitialOnboardingModal({
  isOpen,
  onClose,
  userId,
  currentFullName,
  currentEmail,
}: InitialOnboardingModalProps) {
  console.log("🎯 InitialOnboardingModal rendered:", { isOpen, userId, currentFullName, currentEmail });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();

  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [usernameLength, setUsernameLength] = useState(0);
  const [phoneNumberLength, setPhoneNumberLength] = useState(0);

  const form = useForm<InitialOnboardingValues>({
    resolver: zodResolver(initialOnboardingSchema),
    defaultValues: {
      username: "",
      phoneNumber: "",
    },
  });

  // Watch username changes to update character count
  const usernameValue = form.watch("username");
  const phoneValue = form.watch("phoneNumber");

  useEffect(() => {
    setUsernameLength(usernameValue?.length || 0);
  }, [usernameValue]);

  useEffect(() => {
    // Count only digits for phone number length - exactly like ProfileClient
    const digitsOnly = phoneValue?.replace(/\D/g, '') || '';
    setPhoneNumberLength(digitsOnly.length);
  }, [phoneValue]);

  async function handleUsernameBlur(e: React.FocusEvent<HTMLInputElement>) {
    const username = e.target.value.trim();
    if (username.length < 3) {
      setUsernameAvailable(null);
      return;
    }
    setCheckingUsername(true);
    try {
      const res = await fetch(
        `/api/check-username?username=${encodeURIComponent(username)}`,
      );
      if (!res.ok) {
        throw new Error("Failed to check username");
      }
      const data = await res.json();
      setUsernameAvailable(data.available);
    } catch (error) {
      console.error("Error checking username:", error);
      setUsernameAvailable(null);
      toast.error("Could not verify username availability. Please try again.");
    } finally {
      setCheckingUsername(false);
    }
  }

  function checkUsernameValid(username: string): boolean {
    return USERNAME_REGEX.test(username);
  }

  // Helper function to format phone number input - exact same as ProfileClient
  const formatPhoneNumber = (value: string): string => {
    if (!value) return value;
    const phoneNumber = value.replace(/[^\d]/g, ""); // Allow only digits
    const phoneNumberLength = phoneNumber.length;

    if (phoneNumberLength < 4) return phoneNumber;
    if (phoneNumberLength < 7) {
      return `${phoneNumber.slice(0, 3)}-${phoneNumber.slice(3)}`;
    }
    return `${phoneNumber.slice(0, 3)}-${phoneNumber.slice(3, 6)}-${phoneNumber.slice(6, 10)}`;
  };


  async function onSubmit(values: InitialOnboardingValues) {
    setIsSubmitting(true);

    if (checkingUsername) {
      toast.error("Username availability is still being checked.");
      setIsSubmitting(false);
      return;
    }

    if (usernameAvailable === false) {
      toast.error("Username not available. Please choose a different username.");
      setIsSubmitting(false);
      return;
    }

    try {
      const result = await completeInitialOnboarding(
        values.username,
        values.phoneNumber
      );

      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Welcome to Let's Assist! Your profile has been set up.");

        // Force refresh the user to get updated metadata with multiple retries
        const supabase = createClient();
        let retries = 0;
        const maxRetries = 5;

        const waitForMetadataUpdate = async (): Promise<boolean> => {
          try {
            const { data: { user }, error } = await supabase.auth.getUser();
            if (error) {
              console.warn("Error fetching updated user after onboarding:", error);
              return false;
            }

            const hasCompletedOnboarding = user?.user_metadata?.has_completed_onboarding === true;
            console.log("User metadata check:", user?.user_metadata, "Completed:", hasCompletedOnboarding);

            if (hasCompletedOnboarding) {
              console.log("Onboarding metadata successfully updated");
              return true;
            }

            if (retries < maxRetries) {
              retries++;
              console.log(`Waiting for metadata update, retry ${retries}/${maxRetries}`);
              await new Promise(resolve => setTimeout(resolve, 1000));
              return await waitForMetadataUpdate();
            }

            return false;
          } catch (refreshError) {
            console.warn("User fetch failed after onboarding:", refreshError);
            return false;
          }
        };

        // Wait for metadata to be updated
        const metadataUpdated = await waitForMetadataUpdate();

        if (metadataUpdated) {
          console.log("Metadata confirmed updated, closing modal");
        } else {
          console.warn("Metadata update timeout, but proceeding anyway");
        }

        // Close modal immediately after success
        onClose();

        // Refresh page after a short delay to ensure all UI updates
        setTimeout(() => {
          window.location.href = "/";
        }, 1000);
      }
    } catch (error) {
      console.error("Onboarding submission error:", error);
      toast.error("An unexpected error occurred. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  // Prevent closing the dialog by clicking outside or pressing Escape
  const handleInteractOutside = (event: Event) => {
    event.preventDefault();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="w-full max-w-[95vw] sm:max-w-[425px]"
        onInteractOutside={handleInteractOutside}
        onEscapeKeyDown={handleInteractOutside} // Also prevent Esc key
      >
        <DialogHeader>
          <DialogTitle>Welcome to Let&apos;s Assist!</DialogTitle>
          <DialogDescription>
            Let&apos;s set up your profile. Note: this won&apos;t display again after you complete onboarding.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 py-4">
            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <div className="flex justify-between items-center">
                    <FormLabel>Username</FormLabel>
                    <span
                      className={`text-xs ${usernameLength > USERNAME_MAX_LENGTH ? "text-destructive font-semibold" : "text-muted-foreground"}`}
                    >
                      {usernameLength}/{USERNAME_MAX_LENGTH}
                    </span>
                  </div>
                  <div className="relative">
                    <FormControl>
                      <Input
                        placeholder="Choose a unique username"
                        {...field}
                        maxLength={USERNAME_MAX_LENGTH}
                        onChange={(e) => {
                          const noSpaces = e.target.value.replace(
                            /\s/g,
                            "",
                          );
                          const lower = noSpaces.toLowerCase();
                          field.onChange(lower);
                          setUsernameLength(lower.length);
                        }}
                        onBlur={(e) => {
                          field.onBlur();
                          handleUsernameBlur(e);
                        }}
                        className={
                          !checkUsernameValid(field.value || "") &&
                            field.value
                            ? "border-destructive"
                            : undefined
                        }
                      />
                    </FormControl>
                    {checkingUsername && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
                      </div>
                    )}
                    {usernameAvailable !== null &&
                      !checkingUsername && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                          {usernameAvailable ? (
                            <CircleCheck className="h-5 w-5 text-primary" />
                          ) : (
                            <XCircle className="h-5 w-5 text-destructive" />
                          )}
                        </div>
                      )}
                  </div>
                  <FormDescription className="flex items-center gap-1.5">
                    Only letters, numbers, underscores, dots, and
                    hyphens allowed
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="phoneNumber"
              render={({ field }) => (
                <FormItem>
                  <div className="flex justify-between items-center">
                    <FormLabel>Phone Number (Optional)</FormLabel>
                    <span
                      className={`text-xs ${phoneNumberLength > PHONE_LENGTH ? "text-destructive font-semibold" : "text-muted-foreground"}`}
                    >
                      {phoneNumberLength}/{PHONE_LENGTH}
                    </span>
                  </div>
                  <FormControl>
                    <Input
                      type="tel"
                      placeholder="XXX-XXX-XXXX"
                      {...field}
                      value={field.value || ""}
                      onChange={(e) => {
                        const formatted = formatPhoneNumber(e.target.value);
                        field.onChange(formatted);
                        setPhoneNumberLength(formatted.replace(/-/g, "").length);
                      }}
                      maxLength={12} // Max length for XXX-XXX-XXXX format
                    />
                  </FormControl>
                  <FormDescription>
                    Enter your 10-digit phone number. This will be used for contact when signing up/creating projects.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                type="submit"
                disabled={
                  isSubmitting ||
                  checkingUsername ||
                  Boolean(usernameValue && usernameValue.length >= USERNAME_MIN_LENGTH && usernameAvailable === false)
                }
                className="w-full sm:w-auto"
              >
                {isSubmitting ? "Setting up your profile..." : "Complete Setup"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}