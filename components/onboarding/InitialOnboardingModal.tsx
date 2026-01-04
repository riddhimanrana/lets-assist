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
import { completeInitialOnboarding } from "./onboarding-actions";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { CircleCheck, XCircle, Sparkles, Building2, ArrowRight, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

// Constants for validation
const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 32;
const PHONE_LENGTH = 10;
const USERNAME_REGEX = /^[a-zA-Z0-9_.-]+$/;

interface InitialOnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  currentFullName?: string | null;
  currentEmail?: string | null;
  autoJoinedOrg?: { id: string; name: string } | null;
}

export default function InitialOnboardingModal({
  isOpen,
  onClose,
  userId,
  currentFullName,
  currentEmail,
  autoJoinedOrg,
}: InitialOnboardingModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [usernameLength, setUsernameLength] = useState(0);
  const [phoneNumberLength, setPhoneNumberLength] = useState(0);
  const [orgLogoUrl, setOrgLogoUrl] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Fetch org logo if auto-joined
  useEffect(() => {
    if (autoJoinedOrg?.id) {
      const supabase = createClient();
      supabase
        .from("organizations")
        .select("logo_url")
        .eq("id", autoJoinedOrg.id)
        .single()
        .then(({ data }) => {
          if (data?.logo_url) {
            setOrgLogoUrl(data.logo_url);
          }
        });
    }
  }, [autoJoinedOrg?.id]);

  const form = useForm<InitialOnboardingValues>({
    resolver: zodResolver(initialOnboardingSchema),
    defaultValues: {
      username: "",
      phoneNumber: "",
    },
  });

  const usernameValue = form.watch("username");
  const phoneValue = form.watch("phoneNumber");

  useEffect(() => {
    setUsernameLength(usernameValue?.length || 0);
  }, [usernameValue]);

  useEffect(() => {
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
      if (!res.ok) throw new Error("Failed to check username");
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

  const formatPhoneNumber = (value: string): string => {
    if (!value) return value;
    const phoneNumber = value.replace(/[^\d]/g, "");
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

            if (hasCompletedOnboarding) {
              const autoJoinedOrgName = user?.user_metadata?.auto_joined_org_name;
              if (autoJoinedOrgName) {
                setTimeout(() => {
                  toast.info(`You've been automatically added to ${autoJoinedOrgName} based on your email domain.`, {
                    duration: 6000,
                  });
                }, 1500);
              }
              return true;
            }

            if (retries < maxRetries) {
              retries++;
              await new Promise(resolve => setTimeout(resolve, 1000));
              return await waitForMetadataUpdate();
            }

            return false;
          } catch {
            return false;
          }
        };

        await waitForMetadataUpdate();
        onClose();

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

  const handleInteractOutside = (event: Event) => {
    event.preventDefault();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="w-full max-w-[95vw] sm:max-w-[480px] p-0 overflow-hidden gap-0"
        onInteractOutside={handleInteractOutside}
        onEscapeKeyDown={handleInteractOutside}
      >
        <AnimatePresence>
          {mounted && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            >
              {/* Header with gradient background */}
              <div className="relative bg-gradient-to-br from-primary/10 via-primary/5 to-background px-6 pt-8 pb-6 border-b">
                <motion.div 
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.1, duration: 0.4 }}
                  className="flex items-center gap-3 mb-4"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Sparkles className="h-6 w-6" />
                  </div>
                  <div>
                    <DialogTitle className="text-xl font-semibold">Welcome to Let&apos;s Assist!</DialogTitle>
                    <DialogDescription className="text-sm">
                      Let&apos;s set up your profile in seconds
                    </DialogDescription>
                  </div>
                </motion.div>

                {/* Auto-joined organization banner */}
                {autoJoinedOrg && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2, duration: 0.4 }}
                    className="flex items-center gap-3 p-3 rounded-lg bg-background/80 backdrop-blur-sm border shadow-sm"
                  >
                    <Avatar className="h-10 w-10 border">
                      <AvatarImage src={orgLogoUrl || undefined} alt={autoJoinedOrg.name} />
                      <AvatarFallback className="bg-primary/10">
                        <Building2 className="h-5 w-5 text-primary" />
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground">You&apos;ve been added to</p>
                      <p className="font-medium text-sm truncate">{autoJoinedOrg.name}</p>
                    </div>
                    <CircleCheck className="h-5 w-5 text-primary shrink-0" />
                  </motion.div>
                )}
              </div>

              {/* Form content */}
              <div className="px-6 py-6">
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                    <motion.div
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.15, duration: 0.3 }}
                    >
                      <FormField
                        control={form.control}
                        name="username"
                        render={({ field }) => (
                          <FormItem>
                            <div className="flex justify-between items-center">
                              <FormLabel className="text-sm font-medium">Choose your username</FormLabel>
                              <span
                                className={`text-xs tabular-nums ${usernameLength > USERNAME_MAX_LENGTH ? "text-destructive font-semibold" : "text-muted-foreground"}`}
                              >
                                {usernameLength}/{USERNAME_MAX_LENGTH}
                              </span>
                            </div>
                            <div className="relative">
                              <FormControl>
                                <Input
                                  placeholder="username"
                                  {...field}
                                  maxLength={USERNAME_MAX_LENGTH}
                                  className="h-11 pr-10 transition-all duration-200 focus:ring-2 focus:ring-primary/20"
                                  onChange={(e) => {
                                    const noSpaces = e.target.value.replace(/\s/g, "");
                                    const lower = noSpaces.toLowerCase();
                                    field.onChange(lower);
                                    setUsernameLength(lower.length);
                                  }}
                                  onBlur={(e) => {
                                    field.onBlur();
                                    handleUsernameBlur(e);
                                  }}
                                />
                              </FormControl>
                              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                {checkingUsername && (
                                  <motion.div
                                    initial={{ scale: 0 }}
                                    animate={{ scale: 1 }}
                                    className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent"
                                  />
                                )}
                                {usernameAvailable !== null && !checkingUsername && (
                                  <motion.div
                                    initial={{ scale: 0 }}
                                    animate={{ scale: 1 }}
                                    transition={{ type: "spring", stiffness: 500, damping: 25 }}
                                  >
                                    {usernameAvailable ? (
                                      <CircleCheck className="h-5 w-5 text-primary" />
                                    ) : (
                                      <XCircle className="h-5 w-5 text-destructive" />
                                    )}
                                  </motion.div>
                                )}
                              </div>
                            </div>
                            <FormDescription className="text-xs">
                              Letters, numbers, underscores, dots, and hyphens only
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </motion.div>

                    <motion.div
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.25, duration: 0.3 }}
                    >
                      <FormField
                        control={form.control}
                        name="phoneNumber"
                        render={({ field }) => (
                          <FormItem>
                            <div className="flex justify-between items-center">
                              <FormLabel className="text-sm font-medium">
                                Phone Number <span className="text-muted-foreground font-normal">(optional)</span>
                              </FormLabel>
                              <span
                                className={`text-xs tabular-nums ${phoneNumberLength > PHONE_LENGTH ? "text-destructive font-semibold" : "text-muted-foreground"}`}
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
                                className="h-11 transition-all duration-200 focus:ring-2 focus:ring-primary/20"
                                onChange={(e) => {
                                  const formatted = formatPhoneNumber(e.target.value);
                                  field.onChange(formatted);
                                  setPhoneNumberLength(formatted.replace(/-/g, "").length);
                                }}
                                maxLength={12}
                              />
                            </FormControl>
                            <FormDescription className="text-xs">
                              Used for project coordination and volunteer signups
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </motion.div>

                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.35, duration: 0.3 }}
                    >
                      <DialogFooter className="pt-2">
                        <Button
                          type="submit"
                          disabled={
                            isSubmitting ||
                            checkingUsername ||
                            Boolean(usernameValue && usernameValue.length >= USERNAME_MIN_LENGTH && usernameAvailable === false)
                          }
                          className="w-full h-11 font-medium gap-2 transition-all duration-200"
                        >
                          {isSubmitting ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Setting up your profile...
                            </>
                          ) : (
                            <>
                              Get Started
                              <ArrowRight className="h-4 w-4" />
                            </>
                          )}
                        </Button>
                      </DialogFooter>
                    </motion.div>
                  </form>
                </Form>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}