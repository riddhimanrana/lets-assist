"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertCircle, CheckCircle2, Mail, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Field,
  FieldLabel,
  FieldError,
} from "@/components/ui/field";
import { Controller } from "react-hook-form";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { motion } from "framer-motion";
import {
  deleteAccount,
  emailDataExport,
  getDataExportJobs,
  setPasswordAction,
  updateEmailAction,
  updatePasswordAction,
} from "./actions";
import { useAuth } from "@/hooks/useAuth";
import { createClient } from "@/lib/supabase/client";

const updatePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Please confirm your new password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "New passwords don't match",
    path: ["confirmPassword"],
  });
type UpdatePasswordValues = z.infer<typeof updatePasswordSchema>;

const setPasswordSchema = z
  .object({
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });
type SetPasswordValues = z.infer<typeof setPasswordSchema>;

const updateEmailSchema = z.object({
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
}).refine((data) => data.newEmail === data.confirmEmail, {
  message: "Email addresses don't match",
  path: ["confirmEmail"],
});
type UpdateEmailValues = z.infer<typeof updateEmailSchema>;

export default function SecurityClient() {
  const { user } = useAuth(); // Use centralized auth hook
  const [isDeleting, setIsDeleting] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [countdownInterval, setCountdownInterval] = useState<NodeJS.Timeout | null>(null);
  const [currentEmail, setCurrentEmail] = useState("");
  const [isPasswordLoading, setIsPasswordLoading] = useState(false);
  const [isEmailLoading, setIsEmailLoading] = useState(false);
  const [isExportEmailing, setIsExportEmailing] = useState(false);
  const [exportJobs, setExportJobs] = useState<any[]>([]);
  const [isExportJobsLoading, setIsExportJobsLoading] = useState(true);

  // Poll for export jobs
  useEffect(() => {
    let interval: NodeJS.Timeout;

    const fetchJobs = async () => {
      const result = await getDataExportJobs();
      if (result.success) {
        setExportJobs(result.jobs);
      }
      setIsExportJobsLoading(false);
    };

    fetchJobs();
    interval = setInterval(fetchJobs, 10000); // Poll every 10s

    return () => clearInterval(interval);
  }, []);

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
        const [{ data: identitiesData }, { data: userData }] = await Promise.all([
          supabase.auth.getUserIdentities(),
          supabase.auth.getUser(),
        ]);

        const identities =
          identitiesData?.identities ?? userData?.user?.identities ?? [];
        const providersFromIdentities = identities
          .map((identity) => identity.provider)
          .filter(Boolean);
        const providersFromMetadata =
          (userData?.user?.app_metadata?.providers as string[] | undefined) ?? [];
        const primaryProvider = userData?.user?.app_metadata
          ?.provider as string | undefined;

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
        console.error("Error checking auth methods:", error);
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
        emailForm.setError("newEmail", { type: "server", message: result.error.newEmail[0] });
      }
      if (result.error.confirmEmail) {
        emailForm.setError("confirmEmail", { type: "server", message: result.error.confirmEmail[0] });
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
          message: result.error.currentPassword[0]
        });
      }
      if (result.error.newPassword) {
        passwordForm.setError("newPassword", {
          type: "server",
          message: result.error.newPassword[0]
        });
      }
      if (result.error.confirmPassword) {
        passwordForm.setError("confirmPassword", {
          type: "server",
          message: result.error.confirmPassword[0]
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
          message: result.error.newPassword[0]
        });
      }
      if (result.error.confirmPassword) {
        setPasswordForm.setError("confirmPassword", {
          type: "server",
          message: result.error.confirmPassword[0]
        });
      }
    } else if (result.success) {
      toast.success("Password set successfully! You can now use email/password to sign in.");
      setPasswordForm.reset();
      // After setting password, user now has password auth capability
      // Note: OAuth users who set a password don't get an "email" identity provider
      // They still only have their OAuth identity, but can now also sign in with password
      setHasPassword(true);
    }
    setIsPasswordLoading(false);
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmation !== "delete my account") {
      toast.error("Please type the confirmation phrase correctly");
      return;
    }

    try {
      setIsDeleting(true);
      let count = 5;
      setCountdown(count);
      const interval = setInterval(() => {
        count--;
        setCountdown(count);
        if (count === 0) {
          clearInterval(interval);
          setCountdownInterval(null);
        }
      }, 1000);
      setCountdownInterval(interval);

      await new Promise((resolve) => setTimeout(resolve, 5000));

      if (count === 0) {
        const result = await deleteAccount();
        if (result.success) {
          localStorage.clear();
          sessionStorage.clear();
          window.location.href = "/?deleted=true&noRedirect=1";
        }
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete account",
      );
      setIsDeleting(false);
    }
    setShowDeleteDialog(false);
  };

  const handleCancelDelete = () => {
    if (countdownInterval) {
      clearInterval(countdownInterval);
      setCountdownInterval(null);
    }
    setIsDeleting(false);
    setCountdown(5);
    setShowDeleteDialog(false);
  };

  const handleEmailDataExport = async () => {
    try {
      setIsExportEmailing(true);
      const result = await emailDataExport();

      if (!result.success) {
        toast.error(result.error || "Failed to send export email");
        return;
      }

      toast.success(
        result.email
          ? `Export queued. We'll email ${result.email} when it's ready.`
          : "Export queued. We'll email you when it's ready.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to email data export",
      );
    } finally {
      setIsExportEmailing(false);
    }
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
              <CardDescription>Change the email address you use to sign in</CardDescription>
            </CardHeader>
            <CardContent className="flex-1">
              <form onSubmit={emailForm.handleSubmit(handleEmailChange)} className="space-y-4">
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
                      <FieldLabel htmlFor={field.name}>Confirm New Email</FieldLabel>
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
                  : `You signed in with ${oauthProvider || "OAuth"}. Set a password to enable email/password login.`
                }
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1">
              {isCheckingAuth ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
              ) : hasPassword ? (
                <form onSubmit={passwordForm.handleSubmit(handlePasswordChange)} className="space-y-4">
                  <Controller
                    control={passwordForm.control}
                    name="currentPassword"
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor="update-current-password">Current Password</FieldLabel>
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
                        <FieldLabel htmlFor="update-new-password">New Password</FieldLabel>
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
                        <span>Cannot be a commonly used or compromised password</span>
                      </li>
                    </ul>
                  </div>

                  <Controller
                    control={passwordForm.control}
                    name="confirmPassword"
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor="update-confirm-password">Confirm New Password</FieldLabel>
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
                <form onSubmit={setPasswordForm.handleSubmit(handleSetPassword)} className="space-y-4">
                  <Controller
                    control={setPasswordForm.control}
                    name="newPassword"
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor="set-new-password">New Password</FieldLabel>
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
                        <span>Cannot be a commonly used or compromised password</span>
                      </li>
                    </ul>
                  </div>

                  <Controller
                    control={setPasswordForm.control}
                    name="confirmPassword"
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor="set-confirm-password">Confirm New Password</FieldLabel>
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
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-xl">Export Your Data</CardTitle>
            <CardDescription>
              Queue a background ZIP export and receive it via email.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Exports include categorized files for profile data, certificates and hours,
              notifications, trust/safety history, auth details, and internal export logs.
              Large exports are delivered via secure signed link to avoid attachment limits.
              <b> Note: Background exports are processed every 20 minutes; you will receive your email within 24 hours.</b>
            </p>

            {exportJobs.length > 0 && (
              <div className="space-y-3 pt-2">
                <Label className="text-sm font-medium">Recent Export Requests</Label>
                <div className="grid grid-cols-1 gap-2">
                  {exportJobs.map((job) => (
                    <div
                      key={job.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-lg border bg-muted/30 text-xs sm:text-sm gap-2"
                    >
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium flex items-center gap-2">
                          {new Date(job.requested_at).toLocaleString()}
                          {job.status === "pending" && (
                            <span className="px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 text-[10px] font-bold uppercase animate-pulse">
                              Pending
                            </span>
                          )}
                          {job.status === "processing" && (
                            <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 text-[10px] font-bold uppercase animate-pulse">
                              Processing
                            </span>
                          )}
                          {job.status === "completed" && (
                            <span className="px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-[10px] font-bold uppercase">
                              Sent
                            </span>
                          )}
                          {job.status === "failed" && (
                            <span className="px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 text-[10px] font-bold uppercase">
                              Failed
                            </span>
                          )}
                        </span>
                        <span className="text-muted-foreground truncate">
                          To: {job.delivery_email}
                          {job.zip_size_bytes && ` • ${(job.zip_size_bytes / 1024 / 1024).toFixed(2)} MB`}
                        </span>
                      </div>
                      {job.status === "completed" && job.signed_url && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs shrink-0"
                          asChild
                        >
                          <a href={job.signed_url} target="_blank" rel="noopener noreferrer">
                            Download Now
                          </a>
                        </Button>
                      )}
                      {job.status === "failed" && job.error_message && (
                        <span className="text-destructive truncate max-w-50" title={job.error_message}>
                          {job.error_message}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                type="button"
                onClick={handleEmailDataExport}
                disabled={isExportEmailing}
                className="w-full sm:w-auto"
              >
                <Mail className="h-4 w-4 mr-2" />
                {isExportEmailing ? "Queueing Export..." : "Email My Zipped Data"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-destructive mt-6">
          <CardHeader className="">
            <CardTitle className="text-destructive">Delete Account</CardTitle>
            <CardDescription>
              Permanently delete your account and all associated data
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
              <AlertDialogTrigger
                render={
                  <Button variant="destructive" className="w-full sm:w-auto">
                    Delete Account
                  </Button>
                }
              />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogMedia className="bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-destructive">
                    <Trash2Icon className="size-5" />
                  </AlertDialogMedia>
                  <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This action cannot be undone. This will permanently delete
                    your account and remove all associated data.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="space-y-4 py-2">
                  <div className="space-y-2">
                    <Label htmlFor="confirm">
                      Type &quot;delete my account&quot; to confirm
                    </Label>
                    <Input
                      id="confirm"
                      value={deleteConfirmation}
                      onChange={(e) => setDeleteConfirmation(e.target.value)}
                      placeholder="delete my account"
                    />
                  </div>
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel onClick={handleCancelDelete}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={(e) => {
                      e.preventDefault();
                      handleDeleteAccount();
                    }}
                    disabled={
                      deleteConfirmation !== "delete my account" || isDeleting
                    }
                  >
                    {isDeleting
                      ? `Deleting in ${countdown}s...`
                      : "Delete Account"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      </div>
    </motion.div>
  );
}
