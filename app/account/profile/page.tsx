"use client";
import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/utils/supabase/client";
import {
    Avatar as AvatarUI,
    AvatarImage,
    AvatarFallback,
} from "@/components/ui/avatar";
import { Upload, CircleCheck, XCircle, Trash2 } from "lucide-react";
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
} from "@/components/ui/form";
import { Toaster, toast } from "sonner";
import { completeOnboarding, removeProfilePicture } from "./actions";
import type { OnboardingValues } from "./actions";
import { z } from "zod";
import ImageCropper from "@/components/ImageCropper";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";

// Modified schema: preprocess empty strings into undefined so that non-updated values pass validation.
const onboardingSchema = z.object({
    fullName: z.preprocess(
        (val) =>
            typeof val === "string" && val.trim() === "" ? undefined : val,
        z.string().min(3, "Full name must be at least 3 characters").optional()
    ),
    username: z.preprocess(
        (val) =>
            typeof val === "string" && val.trim() === "" ? undefined : val,
        z.string().min(3, "Username must be at least 3 characters").optional()
    ),
    avatarUrl: z.string().optional(),
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
            <div className="flex items-center space-x-4">
                <AvatarUI className="w-20 h-20">
                    <AvatarImage src={url || undefined} alt="Profile picture" />
                    <AvatarFallback>{url ? "PIC" : "ADD"}</AvatarFallback>
                </AvatarUI>
                <div className="flex items-center space-x-2">
                    <Button variant="outline" className="relative" disabled={isUploading}>
                        <Upload className="w-5 h-5 mr-2" />
                        {isUploading ? "Uploading..." : "Upload Picture"}
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
                            className="text-destructive bg-destructive/10 hover:bg-destructive/10"
                            title="Remove Picture"
                        >
                            <Trash2 className="w-5 h-5" /> Remove
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

export default function AccountSettings() {
    const [isLoading, setIsLoading] = useState(false);
    const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
    const [checkingUsername, setCheckingUsername] = useState(false);
    const [defaultValues, setDefaultValues] = useState<OnboardingValues>({
        fullName: "",
        username: "",
        avatarUrl: undefined,
    });
    const [isDataLoading, setIsDataLoading] = useState(true);

    useEffect(() => {
        async function fetchUserProfile() {
            const supabase = createClient();
            try {
                const { data: { user } } = await supabase.auth.getUser();
                const { data: profileData } = await supabase
                    .from("profiles")
                    .select("full_name, avatar_url, username")
                    .eq("id", user?.id)
                    .single();
                console.log(profileData);

                if (profileData) {
                    setDefaultValues({
                        fullName: profileData.full_name,
                        username: profileData.username,
                        avatarUrl: profileData.avatar_url,
                    });
                }
            } catch (error) {
                console.error("Error fetching user profile:", error);
                toast.error("Failed to load profile data");
            } finally {
                setIsDataLoading(false);
            }
        }
        fetchUserProfile();
    }, []);

    const form = useForm<OnboardingValues>({
        resolver: zodResolver(onboardingSchema),
        defaultValues,
        values: defaultValues, // This ensures form updates when defaultValues change
    });

    async function handleUsernameBlur(e: React.FocusEvent<HTMLInputElement>) {
        const username = e.target.value.trim();
        if (username.length < 3) {
            setUsernameAvailable(null);
            return;
        }
        setCheckingUsername(true);
        const res = await fetch(`/api/check-username?username=${encodeURIComponent(username)}`);
        const data = await res.json();
        setUsernameAvailable(data.available);
        setCheckingUsername(false);
    }

    async function onSubmit(data: OnboardingValues) {
        setIsLoading(true);
        const formData = new FormData();

        // Only append defined values
        if (data.fullName) formData.append("fullName", data.fullName);
        if (data.username) formData.append("username", data.username);
        if (data.avatarUrl) formData.append("avatarUrl", data.avatarUrl);

        const result = await completeOnboarding(formData);

        if (!result) return;

        if (result.error) {
            const errors = result.error;
            Object.keys(errors).forEach((key) => {
                form.setError(key as keyof OnboardingValues, {
                    type: "server",
                    message: errors[key as keyof typeof errors]?.[0],
                });
            });
            toast.error("Failed to update profile. Please try again.");
        } else {
            toast.success("Profile updated successfully!");
            setTimeout(() => {
                window.location.href = "/account/profile";
            }, 1000);
        }

        setIsLoading(false);
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
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <div className="container mx-auto py-6 max-w-7xl">
                {/* Main Content Header */}
                <div className="space-y-6">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">Profile</h1>
                        <p className="text-muted-foreground">
                            Manage your personal information and how others see you
                        </p>
                    </div>

                    <Card>
                        <CardHeader>
                            <CardTitle>Profile Picture</CardTitle>
                            <CardDescription>
                                Choose a profile picture for your account
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {isDataLoading ? (
                                <div className="space-y-6">
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
                                                        url={typeof field.value === "string" ? field.value : ""}
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

                    <Card>
                        <CardHeader>
                            <CardTitle>Personal Information</CardTitle>
                            <CardDescription>
                                Update your personal details and public profile
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {isDataLoading ? (
                                <div className="space-y-6">
                                    <Skeleton className="h-10 w-full" />
                                    <Skeleton className="h-10 w-full" />
                                </div>
                            ) : (
                                <Form {...form}>
                                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                                        <div className="grid gap-6">
                                            <FormField
                                                control={form.control}
                                                name="fullName"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>Full Name</FormLabel>
                                                        <FormControl>
                                                            <Input placeholder="Enter your full name" {...field} />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />

                                            <FormField
                                                control={form.control}
                                                name="username"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>Username</FormLabel>
                                                        <div className="relative">
                                                            <FormControl>
                                                                <Input
                                                                    placeholder="Choose a unique username"
                                                                    {...field}
                                                                    onChange={(e) => {
                                                                        const noSpaces = e.target.value.replace(/\s/g, "");
                                                                        field.onChange(noSpaces);
                                                                    }}
                                                                    onBlur={(e) => {
                                                                        field.onBlur();
                                                                        handleUsernameBlur(e);
                                                                    }}
                                                                />
                                                            </FormControl>
                                                            {checkingUsername && (
                                                                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                                                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
                                                                </div>
                                                            )}
                                                            {usernameAvailable !== null && !checkingUsername && (
                                                                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                                                    {usernameAvailable ? (
                                                                        <CircleCheck className="h-5 w-5 text-primary" />
                                                                    ) : (
                                                                        <XCircle className="h-5 w-5 text-destructive" />
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                        </div>

                                        <div className="flex justify-end">
                                            <Button
                                                type="submit"
                                                disabled={isLoading || !form.formState.isDirty}
                                            >
                                                {isLoading ? "Saving Changes..." : "Save Changes"}
                                            </Button>
                                        </div>
                                    </form>
                                </Form>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
            <Toaster position="bottom-right" theme="dark" richColors />
        </motion.div>
    );
}
