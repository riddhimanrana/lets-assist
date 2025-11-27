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
import { Upload, CircleCheck, XCircle, Shield, AlertTriangle, Calendar, Info, Mail, AlertCircle, MoreHorizontal, Loader2, ShieldCheck, Trash, Trash2, CheckCircle } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { completeOnboarding, removeProfilePicture, updateNameAndUsername, updateProfileVisibility, updateDateOfBirth } from "./actions";
import type { OnboardingValues } from "./actions";
import { z } from "zod";
import ImageCropper from "@/components/ImageCropper";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { calculateAge } from "@/utils/age-helpers";
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
  const [dateOfBirth, setDateOfBirth] = useState<string | null>(null);
  const [dobInput, setDobInput] = useState('');
  const [isUpdatingDob, setIsUpdatingDob] = useState(false);
  const [dobError, setDobError] = useState<string | null>(null);
  const [emailDomain, setEmailDomain] = useState<string | null>(null);
  const [requiresParentalConsent, setRequiresParentalConsent] = useState(false);
  const [age, setAge] = useState<number | null>(null);

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
      setDateOfBirth(null);
      setDobInput("");
      setRequiresParentalConsent(false);
      setCanChangeVisibility(true);
      setAge(null);

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
    setDateOfBirth(profile.date_of_birth ?? null);
    setDobInput(profile.date_of_birth || "");
    setRequiresParentalConsent(Boolean(profile.parental_consent_required));

    if (profile.date_of_birth) {
      const userAge = calculateAge(profile.date_of_birth);
      setAge(userAge);
      setCanChangeVisibility(userAge >= 13);
    } else {
      setAge(null);
      setCanChangeVisibility(true);
    }

    const emailSource = profile.email || user?.email || null;
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

  // Handler for date of birth update
  async function handleDobSave() {
    if (!dobInput) {
      setDobError("Date of birth is required");
      return;
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(dobInput)) {
      setDobError("Please enter date in YYYY-MM-DD format");
      return;
    }

    // Validate date is in the past
    const inputDate = new Date(dobInput);
    if (inputDate > new Date()) {
      setDobError("Date of birth cannot be in the future");
      return;
    }

    setIsUpdatingDob(true);
    setDobError(null);

    try {
      const result = await updateDateOfBirth(dobInput);

      if (result.error) {
        // Extract error message from error object
        const errorMsg = result.error.dateOfBirth?.[0] || result.error.server?.[0] || 'Failed to update date of birth';
        setDobError(errorMsg);
        toast.error(errorMsg);
        return;
      }

      if (result.success) {
        setDateOfBirth(dobInput);

        // Update age and visibility constraints
        if (result.age !== undefined) {
          setAge(result.age);
          setCanChangeVisibility(result.canChangeVisibility);

          if (result.age < 13 && result.requiresParentalConsent) {
            setRequiresParentalConsent(true);
            toast.warning("Profile locked to private. Parental consent required.");
          }
        }

        if (result.visibility) {
          setProfileVisibility(result.visibility);
        }

        toast.success("Date of birth updated successfully");
      }
    } catch (error) {
      console.error("Error updating DOB:", error);
      const errorMsg = "Failed to update date of birth";
      setDobError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setIsUpdatingDob(false);
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
            <Card>
              <CardContent className="pt-6 flex justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Email Addresses</CardTitle>
                <CardDescription>
                  Manage the email addresses associated with your account.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-3">
                  {emails.map((email) => {
                    const isVerified = Boolean(email.verified_at);
                    return (
                      <div
                        key={email.id}
                        className="flex items-center justify-between gap-3 rounded-lg border bg-card/20 px-4 py-3"
                      >
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-medium text-foreground">
                              {email.email}
                            </span>
                            <Badge
                              variant={isVerified ? "outline" : "destructive"}
                              className="text-[0.65rem] font-semibold"
                            >
                              {isVerified ? "Verified" : "Unverified"}
                            </Badge>
                            {email.is_primary && (
                              <span className="text-xs font-semibold text-primary">
                                Primary
                              </span>
                            )}
                            {pendingPrimaryEmail === email.email && (
                              <span className="text-xs font-semibold text-muted-foreground">
                                Pending confirmation
                              </span>
                            )}
                          </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
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
                              className="gap-2 text-destructive"
                            >
                              <Trash className="h-4 w-4 text-destructive" />
                              Remove email
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    );
                  })}
                </div>

                {!verificationStep ? (
                  <form onSubmit={handleAddEmail} className="flex gap-2">
                    <div className="grid w-full items-center gap-1.5">
                      <Label htmlFor="email">Add new email</Label>
                      <div className="flex gap-2">
                        <Input
                          id="email"
                          type="email"
                          placeholder="Enter email address"
                          value={newEmail}
                          onChange={(e) => setNewEmail(e.target.value)}
                          required
                        />
                        <Button type="submit" disabled={adding}>
                          {adding && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                          Add
                        </Button>
                      </div>
                    </div>
                  </form>
                ) : (
                  <div className="space-y-4 border p-4 rounded-lg bg-muted/20">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <AlertCircle className="h-4 w-4" />
                      <span>
                        Verification code sent to <strong>{pendingEmail}</strong>
                      </span>
                    </div>
                    <form onSubmit={handleVerifyEmail} className="flex gap-2">
                      <div className="grid w-full items-center gap-1.5">
                        <Label htmlFor="code">Verification Code</Label>
                        <div className="flex gap-2">
                          <Input
                            id="code"
                            type="text"
                            placeholder="123456"
                            value={verificationCode}
                            onChange={(e) => setVerificationCode(e.target.value)}
                            required
                            maxLength={6}
                          />
                          <Button type="submit" disabled={verifying}>
                            {verifying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Verify
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => {
                              setVerificationStep(false);
                              setVerificationCode("");
                              setPendingEmail("");
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    </form>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Privacy & Safety Card */}
          <Card className="mt-6">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                <CardTitle>Privacy & Safety</CardTitle>
              </div>
              <CardDescription>
                Manage your profile visibility and age verification
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {isDataLoading ? (
                <div className="space-y-4">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : (
                <>
                  {/* Profile Visibility Toggle */}
                  <div className="flex items-start justify-between space-x-4 rounded-lg border p-4">
                    <div className="flex-1 space-y-1">
                      <Label htmlFor="profile-visibility" className="text-base font-medium">
                        Profile Visibility
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        {profileVisibility === 'public'
                          ? 'Your profile is visible to everyone'
                          : 'Your profile is only visible to you and admins'}
                      </p>
                      {!canChangeVisibility && (
                        <div className="flex items-center gap-1 mt-2">
                          <Info className="h-3 w-3 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">
                            Profile locked to private (age restriction)
                          </span>
                        </div>
                      )}
                    </div>
                    <Switch
                      id="profile-visibility"
                      checked={profileVisibility === 'public'}
                      onCheckedChange={handleVisibilityChange}
                      disabled={isVisibilityLoading || !canChangeVisibility}
                    />
                  </div>

                  {/* Date of Birth Section */}
                  <div className="rounded-lg border p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4" />
                      <Label htmlFor="dob" className="text-base font-medium">
                        Date of Birth
                      </Label>
                      {age !== null && (
                        <Badge variant="secondary" className="ml-auto">
                          Age: {age}
                        </Badge>
                      )}
                    </div>

                    {dateOfBirth ? (
                      <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">
                          Your date of birth: <span className="font-medium">{new Date(dateOfBirth).toLocaleDateString()}</span>
                        </p>
                        {age !== null && age < 13 && (
                          <Alert variant="warning" className="mt-2">
                            <AlertTriangle className="h-4 w-4" />
                            <AlertTitle>Restricted Account</AlertTitle>
                            <AlertDescription>
                              Your account is restricted due to age requirements. Your profile is locked to private visibility.
                            </AlertDescription>
                          </Alert>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-sm text-muted-foreground">
                          Add your date of birth for age verification
                        </p>
                        <div className="flex gap-2">
                          <Input
                            id="dob"
                            type="date"
                            value={dobInput}
                            onChange={(e) => {
                              setDobInput(e.target.value);
                              setDobError(null);
                            }}
                            max={new Date().toISOString().split('T')[0]}
                            className={dobError ? 'border-destructive' : ''}
                          />
                          <Button
                            onClick={handleDobSave}
                            disabled={isUpdatingDob || !dobInput}
                          >
                            {isUpdatingDob ? 'Saving...' : 'Save'}
                          </Button>
                        </div>
                        {dobError && (
                          <p className="text-sm text-destructive">{dobError}</p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Parental Consent Warning */}
                  {requiresParentalConsent && (
                    <Alert variant="warning">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle>Parental Consent Required</AlertTitle>
                      <AlertDescription>
                        We still need a parent or guardian to approve your account.{' '}
                        <a
                          href="/account/parental-consent"
                          className="underline font-medium hover:text-primary"
                        >
                          Request consent here
                        </a>
                      </AlertDescription>
                    </Alert>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </motion.div>
  );
}