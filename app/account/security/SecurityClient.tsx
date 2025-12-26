"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { deleteAccount, updatePasswordAction, updateEmailAction } from "./actions";
import { useAuth } from "@/hooks/useAuth";

const updatePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "New passwords don't match",
    path: ["confirmPassword"],
  });
type UpdatePasswordValues = z.infer<typeof updatePasswordSchema>;

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

  const passwordForm = useForm<UpdatePasswordValues>({
    resolver: zodResolver(updatePasswordSchema),
    defaultValues: {
      currentPassword: "",
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
          toast.success("Account successfully deleted");
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
            <CardHeader className="p-5">
              <CardTitle className="text-xl">Email Address</CardTitle>
              <CardDescription>Change your email address</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 p-5">
              <Form {...emailForm}>
          <form onSubmit={emailForm.handleSubmit(handleEmailChange)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="current-email">Current Email</Label>
              <Input
                id="current-email"
                type="email"
                value={currentEmail}
                disabled
                readOnly
              />
            </div>
            <FormField
              control={emailForm.control}
              name="newEmail"
              render={({ field }) => (
                <FormItem>
            <FormLabel>New Email</FormLabel>
            <FormControl>
              <Input type="email" placeholder="Enter new email" {...field} />
            </FormControl>
            <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={emailForm.control}
              name="confirmEmail"
              render={({ field }) => (
                <FormItem>
            <FormLabel>Confirm New Email</FormLabel>
            <FormControl>
              <Input type="email" placeholder="Confirm new email" {...field} />
            </FormControl>
            <FormMessage />
                </FormItem>
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
              </Form>
            </CardContent>
          </Card>
          <Card className="flex flex-col h-full">
            <CardHeader className="p-5">
              <CardTitle className="text-xl">Password</CardTitle>
              <CardDescription>Change your password</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 p-5">
              <Form {...passwordForm}>
          <form onSubmit={passwordForm.handleSubmit(handlePasswordChange)} className="space-y-4">
            <div className="space-y-2">
              <FormField
                control={passwordForm.control}
                name="currentPassword"
                render={({ field }) => (
            <FormItem>
              <FormLabel>Current Password</FormLabel>
              <FormControl>
                <Input type="password" placeholder="Enter current password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
                )}
              />
            </div>
            <FormField
              control={passwordForm.control}
              name="newPassword"
              render={({ field }) => (
                <FormItem>
            <FormLabel>New Password</FormLabel>
            <FormControl>
              <Input type="password" placeholder="Enter new password" {...field} />
            </FormControl>
            <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={passwordForm.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
            <FormLabel>Confirm New Password</FormLabel>
            <FormControl>
              <Input type="password" placeholder="Confirm new password" {...field} />
            </FormControl>
            <FormMessage />
                </FormItem>
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
              </Form>
            </CardContent>
          </Card>
        </div>
        <Card className="border-destructive mt-6">
          <CardHeader className="p-6">
            <CardTitle className="text-destructive">Delete Account</CardTitle>
            <CardDescription>
              Permanently delete your account and all associated data
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6">
            <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
              <DialogTrigger asChild>
                <Button variant="destructive" className="w-full sm:w-auto">
                  Delete Account
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg max-w-[95vw]">
                <DialogHeader>
                  <DialogTitle>Are you absolutely sure?</DialogTitle>
                  <DialogDescription>
                    This action cannot be undone. This will permanently delete
                    your account and remove all associated data.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
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
                <DialogFooter className="flex-col sm:flex-row gap-2">
                  <Button
                    variant="destructive"
                    onClick={handleDeleteAccount}
                    disabled={
                      deleteConfirmation !== "delete my account" || isDeleting
                    }
                    className="w-full sm:w-auto order-2 sm:order-1"
                  >
                    {isDeleting
                      ? `Deleting in ${countdown}s...`
                      : "Delete Account"}
                  </Button>
                  {isDeleting && (
                    <Button
                      variant="secondary"
                      onClick={handleCancelDelete}
                      className="w-full sm:w-auto order-1 sm:order-2"
                    >
                      Cancel
                    </Button>
                  )}
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>
      </div>
    </motion.div>
  );
}
