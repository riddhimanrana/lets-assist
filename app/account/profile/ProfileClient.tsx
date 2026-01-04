"use client";

import { useState, useEffect, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { useUserProfile } from "@/hooks/useUserProfile";
import {
  Avatar as AvatarUI,
  AvatarImage,
  AvatarFallback,
} from "@/components/ui/avatar";
import { Upload, CircleCheck, XCircle, Shield, Info, AlertCircle, MoreHorizontal, Loader2, ShieldCheck, Trash, Trash2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { toast } from "sonner";
import { completeOnboarding, removeProfilePicture, updateNameAndUsername, updateProfileVisibility } from "./actions";
import type { OnboardingValues } from "./actions";
import { z } from "zod";
import ImageCropper from "@/components/shared/ImageCropper";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { ProfileVisibility } from "@/types";
import {
    addEmail,
    unlinkEmail,
    setPrimaryEmail,
    getLinkedIdentities,
    verifyEmail,
} from "@/utils/auth/account-management";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Constants for character limits
const NAME_MAX_LENGTH = 64;
const USERNAME_MAX_LENGTH = 32;
const PHONE_LENGTH = 10; // For raw digits
const USERNAME_REGEX = /^[a-zA-Z0-9_.-]+$/;
const PHONE_REGEX = /^\d{3}-\d{3}-\d{4}$/; // Format XXX-XXX-XXXX

interface UserEmail {
    id: string;
    email: string;
    is_primary: boolean;
    verified_at: string | null;
}

// Moified schema with character limits and validation
const onboardingSchema = z.object({
  fullName: z.preprocess(
    (val) => (typeof val === "string" && val.trim() === "" ? undefined : val),
    z
      .string()
      .min(3, "Full name must be at least 3 characters")
      .max(
        NAME_MAX_LENGTH,
        `Full name cannot exceed ${NAME_MAX_LENGTH} characters`,
      )
      .optional(),
  ),
  username: z.preprocess(
    (val) => (typeof val === "string" && val.trim() === "" ? undefined : val),
    z
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
      .transform((val) => val.toLowerCase())  // <-- force lowercase
      .optional(),
  ),
  avatarUrl: z.string().nullable().optional(),
  phoneNumber: z.preprocess(
    (val) => (typeof val === "string" && val.trim() === "" ? undefined : val),
    z.string()
      .refine(
        (val) => !val || PHONE_REGEX.test(val),
        "Phone number must be in format XXX-XXX-XXXX"
      )
      .transform((val) => {
        if (!val) return undefined;
        // Remove all non-digit characters before storing
        return val.replace(/\D/g, "");
      })
      .optional()
  ),
});

interface AvatarProps {
  url: string;
  onUpload: (url: string) => void;
  onRemove: () => void;
}

function Avatar({ url, onUpload, onRemove }: AvatarProps) {
  const [tempImageUrl, setTempImageUrl] = useState<string>("");
  const [showCropper, setShowCropper] = useState(false);
  const [isRemoving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("File size exceeds 5 MB. Please upload a smaller file.");
      return;
    }
    const fileUrl = URL.createObjectURL(file);
    setTempImageUrl(fileUrl);
    setShowCropper(true);
  };

  const handleCropComplete = async (croppedImage: string) => {
    setIsUploading(true);
    try {
      // Create a FormData object
      const formData = new FormData();
      formData.append("avatarUrl", croppedImage);
      // Call the server action to handle the upload
      const result = await completeOnboarding(formData);
      if (result?.error) {
        toast.error("Failed to upload profile picture");
        return;
      }
      // Update the UI
      onUpload(croppedImage);
      toast.success("Profile picture updated successfully");
      // Refresh the page after a short delay
      setTimeout(() => {
        window.location.href = "/account/profile";
      }, 1000);
    } catch (error) {
      console.error("Error uploading profile picture:", error);
      toast.error("Failed to upload profile picture");
    } finally {
      setIsUploading(false);
      setShowCropper(false);
      setTempImageUrl("");
    }
  };

  const handleCropCancel = () => {
    setShowCropper(false);
    setTempImageUrl("");
  };

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
        <AvatarUI className="w-20 h-20">
          <AvatarImage src={url || undefined} alt="Profile picture" />
          <AvatarFallback>{url ? "PIC" : "ADD"}</AvatarFallback>
        </AvatarUI>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="relative flex-1 sm:flex-none cursor-pointer"
            disabled={isUploading}
          >
            <Upload className="w-4 h-4 mr-2" />
            {isUploading ? "Uploading..." : "Upload"}
            <input
              type="file"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              onChange={handleUpload}
              accept="image/jpeg,image/png,image/jpg"
              disabled={isUploading}
            />
          </Button>
          {url && (
            <Button
              variant="ghost"
              onClick={onRemove}
              disabled={isRemoving || isUploading}
              className="text-destructive bg-destructive/10 hover:bg-destructive/20 flex-1 sm:flex-none"
              title="Remove Picture"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Remove
            </Button>
          )}
        </div>
      </div>
      <Dialog open={showCropper} onOpenChange={setShowCropper}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogTitle className="sr-only">Image Cropper</DialogTitle>
          {showCropper && (
            <ImageCropper
              imageSrc={tempImageUrl}
              onCropComplete={handleCropComplete}
              onCancel={handleCropCancel}
              isUploading={isUploading}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function ProfileClient() {
  const [isLoading, setIsLoading] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(
    null,
  );
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [defaultValues, setDefaultValues] = useState<OnboardingValues>({
    fullName: "",
    username: "",
    avatarUrl: undefined,
    phoneNumber: undefined,
  });
  const [nameLength, setNameLength] = useState(0);
  const [usernameLength, setUsernameLength] = useState(0);
  const [phoneNumberLength, setPhoneNumberLength] = useState(0);

  // Privacy & Safety state
  const [profileVisibility, setProfileVisibility] = useState<ProfileVisibility>('private');
  const [isVisibilityLoading, setIsVisibilityLoading] = useState(false);
  const [canChangeVisibility, setCanChangeVisibility] = useState(true);
  const [emailDomain, setEmailDomain] = useState<string | null>(null);

  // Email management state
  const [emails, setEmails] = useState<UserEmail[]>([]);
  const [emailLoading, setEmailLoading] = useState(true);
  const [newEmail, setNewEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [verificationStep, setVerificationStep] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");
  const [pendingEmail, setPendingEmail] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [pendingPrimaryEmail, setPendingPrimaryEmail] = useState<string | null>(null);
  const { user, isLoading: isAuthLoading } = useAuth();
  const { profile, isLoading: isProfileLoading } = useUserProfile();
  const isDataLoading = isAuthLoading || isProfileLoading;
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
      const emptyValues: OnboardingValues = {
        fullName: "",
        username: "",
        avatarUrl: undefined,
        phoneNumber: undefined,
      };

      setDefaultValues(emptyValues);
      form.reset(emptyValues);
      setNameLength(0);
      setUsernameLength(0);
      setPhoneNumberLength(0);
      setProfileVisibility("private");
      setCanChangeVisibility(true);

      const fallbackDomain = user?.email?.split("@")[1] ?? null;
      setEmailDomain(fallbackDomain);
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

    setNameLength(profile.full_name?.length || 0);
    setUsernameLength(profile.username?.length || 0);
    setPhoneNumberLength(profile.phone?.length || 0);

    setProfileVisibility(
      (profile.profile_visibility as ProfileVisibility) || "private",
    );
    setCanChangeVisibility(true);

    // Email is from auth user, not profile table
    const emailSource = user?.email || null;
    const domain = emailSource ? emailSource.split("@")[1] ?? null : null;
    setEmailDomain(domain);
  }, [profile, isProfileLoading, user?.email, form]);

  const fetchEmails = useCallback(async () => {
    if (!user) {
      setEmails([]);
      setPendingPrimaryEmail(null);
      setEmailLoading(false);
      return;
    }

    setEmailLoading(true);

    try {
      const data = await getLinkedIdentities();
      setEmails(data as UserEmail[]);
      setPendingPrimaryEmail(null);
    } catch (error) {
      console.error("Failed to fetch emails:", error);
      toast.error("Failed to load email addresses");
    } finally {
      setEmailLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchEmails();
  }, [fetchEmails]);

  const handleAddEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail) return;

    setAdding(true);
    try {
      const result = await addEmail(newEmail);
      if (result.error && (result as any).warning) {
        toast.warning(result.error);
        setAdding(false);
        return;
      }

      if (result.error) {
        toast.error(result.error);
        setAdding(false);
        return;
      }

      setPendingEmail(newEmail);
      setVerificationStep(true);
      toast.success("Verification code sent to " + newEmail);
    } catch (error: any) {
      console.error("Error adding email:", error);
      toast.error(error.message || "Failed to add email");
    } finally {
      setAdding(false);
    }
  };

  const handleVerifyEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verificationCode) return;

    setVerifying(true);
    try {
      await verifyEmail(pendingEmail, verificationCode);
      toast.success("Email verified successfully");
      setVerificationStep(false);
      setNewEmail("");
      setVerificationCode("");
      setPendingEmail("");
      fetchEmails();
    } catch (error: any) {
      console.error("Error verifying email:", error);
      toast.error(error.message || "Invalid verification code");
    } finally {
      setVerifying(false);
    }
  };

  const handleRemoveEmail = async (id: string) => {
    try {
      await unlinkEmail(id);
      toast.success("Email removed successfully");
      fetchEmails();
    } catch (error: any) {
      console.error("Error removing email:", error);
      toast.error(error.message || "Failed to remove email");
    }
  };

  const handleSetPrimary = async (email: string, verified: boolean) => {
    if (!verified) {
      toast.error("Only verified emails can be set as primary.");
      return;
    }

    try {
      const result = await setPrimaryEmail(email);
      if (result.needsConfirmation) {
        setPendingPrimaryEmail(result.pendingEmail || email);
        toast.info("Email change pending confirmation. Check your inbox to finish the update.");
        return;
      }
      toast.success("Primary email updated");
      setPendingPrimaryEmail(null);
      setTimeout(fetchEmails, 500);
    } catch (error: any) {
      console.error("Error setting primary email:", error);
      toast.error(error.message || "Failed to update primary email");
    }
  };

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

  function checkUsernameValid(username: string): boolean {
    return USERNAME_REGEX.test(username);
  }

  // Helper function to format phone number input
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


  async function onSubmit(data: OnboardingValues) {
    setIsLoading(true);

    try {
      // Call the updated function with name, username, and phone number
      const result = await updateNameAndUsername(
        data.fullName,
        data.username,
        data.phoneNumber // Pass the transformed (digits only) phone number
      );

      if (!result) {
        toast.error("Failed to update profile. Please try again.");
        setIsLoading(false); // Ensure loading state is reset
        return;
      }

      if (result.error) {
        const errors = result.error;
        Object.keys(errors).forEach((key) => {
          // Map server error keys back to form field names if necessary
          const formKey = key === 'server' ? 'root.serverError' : key as keyof OnboardingValues;
          // Check if the key exists in the form before setting error
          if (formKey in form.getValues() || formKey === 'root.serverError' || formKey === 'phoneNumber') {
            form.setError(formKey as any, { // Use 'any' temporarily if type mapping is complex
              type: "server",
              message: errors[key as keyof typeof errors]?.[0],
            });
          } else {
            // Handle unexpected error keys, maybe log them or show a generic error
            console.warn(`Unexpected error key from server: ${key}`);
            form.setError('root.serverError', {
              type: "server",
              message: "An unexpected validation error occurred."
            });
          }
        });
        toast.error("Failed to update profile. Please check the errors.");
      } else {
        toast.success("Profile updated successfully!");
        // Optionally reset form dirty state if needed
        // form.reset({}, { keepValues: true }); 
        setTimeout(() => {
          window.location.href = "/account/profile";
        }, 1000);
      }
    } catch (error) {
      console.error("Error updating profile:", error);
      toast.error("An unexpected error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  // Handler for profile visibility toggle
  async function handleVisibilityChange(checked: boolean) {
    const newVisibility: ProfileVisibility = checked ? 'public' : 'private';
    setIsVisibilityLoading(true);

    try {
      const result = await updateProfileVisibility(newVisibility);

      if (result.error) {
        // Extract error message from error object
        const errorMsg = result.error.visibility?.[0] || result.error.server?.[0] || 'Failed to update visibility';
        toast.error(errorMsg);
        return;
      }

      if (result.success && result.visibility) {
        setProfileVisibility(result.visibility);
        toast.success(`Profile is now ${result.visibility}`);
      }
    } catch (error) {
      console.error("Error updating visibility:", error);
      toast.error("Failed to update profile visibility");
    } finally {
      setIsVisibilityLoading(false);
    }
  }

  const handleRemoveAvatar = async () => {
    const result = await removeProfilePicture();
    if (result.error) {
      toast.error("Failed to remove profile picture");
      return;
    }
    // Update the form state
    form.setValue("avatarUrl", undefined, { shouldDirty: true });
    setDefaultValues((prev) => ({ ...prev, avatarUrl: undefined }));
    toast.success("Profile picture removed successfully");
    setTimeout(() => {
      window.location.href = "/account/profile";
    }, 1000);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 sm:p-6"
    >
      <div className="max-w-6xl">
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              Profile
            </h1>
            <p className="text-muted-foreground mt-1">
              Manage your personal information and how others see you
            </p>
          </div>
          <Card className="border shadow-sm">
            <CardHeader className="px-5 py-5 sm:px-6">
              <CardTitle className="text-xl">Profile Picture</CardTitle>
              <CardDescription>
                Choose a profile picture for your account
              </CardDescription>
            </CardHeader>
            <CardContent className="px-5 sm:px-6 py-4">
              {isDataLoading ? (
                <div className="flex justify-center">
                  <Skeleton className="h-20 w-20 rounded-full" />
                </div>
              ) : (
                <Form {...form}>
                  <FormField
                    control={form.control}
                    name="avatarUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Avatar
                            url={
                              typeof field.value === "string" ? field.value : ""
                            }
                            onUpload={(url) => field.onChange(url)}
                            onRemove={handleRemoveAvatar}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </Form>
              )}
            </CardContent>
          </Card>
          <Card className="border shadow-sm">
            <CardHeader className="p-5">
              <CardTitle className="text-xl">Personal Information</CardTitle>
              <CardDescription>
                Update your personal details and public profile
              </CardDescription>
            </CardHeader>
            <CardContent className="px-5 sm:px-6 py-4">
              {isDataLoading ? (
                <div className="space-y-6">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" /> {/* Skeleton for Phone */}
                </div>
              ) : (
                <Form {...form}>
                  <form
                    onSubmit={form.handleSubmit(onSubmit)}
                    className="space-y-6"
                  >
                    <div className="grid gap-6">
                      <FormField
                        control={form.control}
                        name="fullName"
                        render={({ field }) => (
                          <FormItem>
                            <div className="flex justify-between items-center">
                              <FormLabel>Full Name</FormLabel>
                              <span
                                className={`text-xs ${nameLength > NAME_MAX_LENGTH ? "text-destructive font-semibold" : "text-muted-foreground"}`}
                              >
                                {nameLength}/{NAME_MAX_LENGTH}
                              </span>
                            </div>
                            <FormControl>
                              <Input
                                placeholder="Enter your full name"
                                {...field}
                                maxLength={NAME_MAX_LENGTH}
                                onChange={(e) => {
                                  field.onChange(e);
                                  setNameLength(e.target.value.length);
                                }}
                              />
                            </FormControl>
                            <FormDescription>
                              Your full name as you&apos;d like others to see it
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
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
                                  placeholder="Enter your username"
                                  {...field}
                                  maxLength={USERNAME_MAX_LENGTH}
                                  onChange={(e) => {
                                    const noSpaces = e.target.value.replace(
                                      /\s/g,
                                      "",
                                    );
                                    const lower = noSpaces.toLowerCase();          // <-- lowercase here
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
                                      : ""
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
                                type="tel" // Use tel type for better mobile UX
                                placeholder="XXX-XXX-XXXX"
                                {...field}
                                value={field.value || ""} // Ensure value is controlled
                                onChange={(e) => {
                                  const formatted = formatPhoneNumber(e.target.value);
                                  field.onChange(formatted); // Update form with formatted value
                                  setPhoneNumberLength(formatted.replace(/-/g, "").length); // Update length count (digits only)
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
                    </div>
                    <div className="flex justify-end">
                      <Button
                        type="submit"
                        disabled={isLoading || !form.formState.isDirty}
                        className="w-full sm:w-auto"
                      >
                        {isLoading ? "Saving Changes..." : "Save Changes"}
                      </Button>
                    </div>
                  </form>
                </Form>
              )}
            </CardContent>
          </Card>

          {/* Email Management Section */}
          {emailLoading ? (
            <Card className="border shadow-sm">
              <CardContent className="pt-6 flex justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </CardContent>
            </Card>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              <Card className="border shadow-sm">
                <CardHeader className="px-5 py-5 sm:px-6">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                      <svg className="h-4 w-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div>
                      <CardTitle className="text-xl">Email Addresses</CardTitle>
                      <CardDescription>
                        Manage email addresses linked to your account
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="px-5 sm:px-6 py-4 space-y-4">
                  <div className="space-y-2">
                    {emails.map((email, index) => {
                      const isVerified = Boolean(email.verified_at);
                      return (
                        <motion.div
                          key={email.id}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: index * 0.05 }}
                          className="group flex items-center justify-between gap-3 rounded-lg border bg-card hover:bg-accent/5 transition-colors px-4 py-3"
                        >
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${isVerified ? 'bg-primary/10' : 'bg-destructive/10'}`}>
                              {isVerified ? (
                                <CircleCheck className="h-4 w-4 text-primary" />
                              ) : (
                                <AlertCircle className="h-4 w-4 text-destructive" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <span className="text-sm font-medium text-foreground truncate block">
                                {email.email}
                              </span>
                              <div className="flex items-center gap-2 mt-0.5">
                                {email.is_primary && (
                                  <Badge variant="secondary" className="text-[0.6rem] font-semibold px-1.5 py-0">
                                    Primary
                                  </Badge>
                                )}
                                {!isVerified && (
                                  <span className="text-xs text-destructive">Unverified</span>
                                )}
                                {pendingPrimaryEmail === email.email && (
                                  <span className="text-xs text-muted-foreground">Pending confirmation</span>
                                )}
                              </div>
                            </div>
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuItem
                                onSelect={() => handleSetPrimary(email.email, isVerified)}
                                disabled={!isVerified || email.is_primary}
                                className="gap-2"
                              >
                                <ShieldCheck className="h-4 w-4" />
                                Set as primary
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onSelect={() => handleRemoveEmail(email.id)}
                                disabled={email.is_primary}
                                className="gap-2 text-destructive focus:text-destructive"
                              >
                                <Trash className="h-4 w-4" />
                                Remove email
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </motion.div>
                      );
                    })}
                  </div>

                  {!verificationStep ? (
                    <form onSubmit={handleAddEmail} className="pt-2">
                      <div className="space-y-2">
                        <Label htmlFor="email" className="text-sm font-medium">Add new email</Label>
                        <div className="flex gap-2">
                          <Input
                            id="email"
                            type="email"
                            placeholder="you@example.com"
                            value={newEmail}
                            onChange={(e) => setNewEmail(e.target.value)}
                            required
                            className="flex-1"
                          />
                          <Button type="submit" disabled={adding} className="shrink-0">
                            {adding && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Add Email
                          </Button>
                        </div>
                      </div>
                    </form>
                  ) : (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="space-y-4 border p-4 rounded-lg bg-primary/5 border-primary/20"
                    >
                      <div className="flex items-center gap-2 text-sm">
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10">
                          <svg className="h-3 w-3 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                        </div>
                        <span>
                          Verification code sent to <strong className="text-foreground">{pendingEmail}</strong>
                        </span>
                      </div>
                      <form onSubmit={handleVerifyEmail}>
                        <div className="space-y-2">
                          <Label htmlFor="code" className="text-sm font-medium">Enter 6-digit code</Label>
                          <div className="flex gap-2">
                            <Input
                              id="code"
                              type="text"
                              placeholder="123456"
                              value={verificationCode}
                              onChange={(e) => setVerificationCode(e.target.value)}
                              required
                              maxLength={6}
                              className="flex-1 font-mono tracking-widest"
                            />
                            <Button type="submit" disabled={verifying} className="shrink-0">
                              {verifying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                              Verify
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => {
                                setVerificationStep(false);
                                setVerificationCode("");
                                setPendingEmail("");
                              }}
                              className="shrink-0"
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      </form>
                    </motion.div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Privacy & Safety Card */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
          >
            <Card className="border shadow-sm">
              <CardHeader className="px-5 py-5 sm:px-6">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                    <Shield className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-xl">Privacy & Safety</CardTitle>
                    <CardDescription>
                      Control who can see your profile
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="px-5 sm:px-6 py-4">
                {isDataLoading ? (
                  <Skeleton className="h-20 w-full" />
                ) : (
                  <div className="flex items-center justify-between gap-4 rounded-lg border bg-card hover:bg-accent/5 transition-colors p-4">
                    <div className="flex items-center gap-3">
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors ${profileVisibility === 'public' ? 'bg-primary/10' : 'bg-muted'}`}>
                        {profileVisibility === 'public' ? (
                          <svg className="h-5 w-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        ) : (
                          <svg className="h-5 w-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                          </svg>
                        )}
                      </div>
                      <div className="space-y-0.5">
                        <Label htmlFor="profile-visibility" className="text-sm font-medium cursor-pointer">
                          {profileVisibility === 'public' ? 'Public Profile' : 'Private Profile'}
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          {profileVisibility === 'public'
                            ? 'Anyone can view your profile and volunteer history'
                            : 'Only you and organization admins can see your profile'}
                        </p>
                      </div>
                    </div>
                    <Switch
                      id="profile-visibility"
                      checked={profileVisibility === 'public'}
                      onCheckedChange={handleVisibilityChange}
                      disabled={isVisibilityLoading || !canChangeVisibility}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}