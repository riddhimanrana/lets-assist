"use client";

import { useState, useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Building2,
  Globe,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Upload,
  X,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError as FormMessage, // Alias to minimize diff if needed, but better to use FieldError
} from "@/components/ui/field";
import { Controller } from "react-hook-form";
import { Switch } from "@/components/ui/switch";
import { updateOrganization, checkUsernameAvailability } from "./actions";
import {
  isReservedOrganizationSlug,
  usernameUnavailableMessage,
} from "@/lib/organization/reserved-slugs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import ImageCropper from "@/components/shared/ImageCropper";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Organization } from "@/types";

import { hasOrganizationFormChanges } from "./organization-form-change";

// Constants
const USERNAME_MAX_LENGTH = 32;
const NAME_MAX_LENGTH = 64;
const WEBSITE_MAX_LENGTH = 100;
const DESCRIPTION_MAX_LENGTH = 650;
const USERNAME_REGEX = /^[a-zA-Z0-9_.-]+$/;

const ORG_TYPE_LABELS: Record<string, string> = {
  nonprofit: "Nonprofit Organization",
  school: "Educational Institution",
  company: "Company/Business",
  government: "Government Agency",
  other: "Other",
};

const ORG_TYPE_OPTIONS = [
  "nonprofit",
  "school",
  "company",
  "government",
  "other",
] as const;
type OrganizationTypeOption = (typeof ORG_TYPE_OPTIONS)[number];

// Form schema
const orgUpdateSchema = z.object({
  name: z
    .string()
    .min(2, "Name must be at least 2 characters")
    .max(NAME_MAX_LENGTH, `Name cannot exceed ${NAME_MAX_LENGTH} characters`),

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
    ),

  description: z
    .string()
    .max(
      DESCRIPTION_MAX_LENGTH,
      `Description cannot exceed ${DESCRIPTION_MAX_LENGTH} characters`,
    )
    .optional(),

  website: z
    .string()
    .max(
      WEBSITE_MAX_LENGTH,
      `Website URL cannot exceed ${WEBSITE_MAX_LENGTH} characters`,
    )
    .url("Please enter a valid URL")
    .optional()
    .or(z.literal("")),

  type: z.enum(["nonprofit", "school", "company", "government", "other"]),

  logoUrl: z.string().optional().nullable(),

  showMembersPublicly: z.boolean().optional(),
});

type OrganizationFormValues = z.infer<typeof orgUpdateSchema>;

interface EditOrganizationFormProps {
  organization: OrganizationWithSettings;
  userId: string;
}

type OrganizationWithSettings = Organization & {
  website?: string | null;
  auto_join_domain?: string | null;
  type?: string | null;
  logo_url?: string | null;
  show_members_publicly?: boolean | null;
};

export default function EditOrganizationForm({
  organization,
  userId: _userId,
}: EditOrganizationFormProps) {
  const router = useRouter();
  const resolvedOrgType: OrganizationTypeOption = ORG_TYPE_OPTIONS.includes(
    organization.type as OrganizationTypeOption,
  )
    ? (organization.type as OrganizationTypeOption)
    : "nonprofit";
  const initialValues = useMemo<OrganizationFormValues>(
    () => ({
      name: organization.name || "",
      username: organization.username || "",
      description: organization.description || "",
      website: organization.website || "",
      type: resolvedOrgType,
      logoUrl: organization.logo_url || null,
      showMembersPublicly: organization.show_members_publicly !== false,
    }),
    [
      organization.description,
      organization.logo_url,
      organization.name,
      organization.show_members_publicly,
      organization.username,
      organization.website,
      resolvedOrgType,
    ],
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(
    null,
  );
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [tempImageUrl, setTempImageUrl] = useState<string>("");
  const [showCropper, setShowCropper] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [descriptionLength, setDescriptionLength] = useState(
    organization.description?.length || 0,
  );
  const [hasChanges, setHasChanges] = useState(false);

  // Setup form with initial values from organization
  const form = useForm<OrganizationFormValues>({
    resolver: zodResolver(orgUpdateSchema),
    defaultValues: initialValues,
  });

  // Watch all form values and detect changes more reliably
  const formValues = form.watch();

  useEffect(() => {
    const subscription = form.watch((value) => {
      setHasChanges(
        hasOrganizationFormChanges(
          initialValues,
          value as OrganizationFormValues,
        ),
      );
    });

    return () => subscription.unsubscribe();
  }, [form, initialValues]);

  // Check if organization username is still available when changed
  const currentUsername = organization.username;

  const handleUsernameBlur = async (value: string) => {
    if (value === currentUsername) {
      // Username hasn't changed, so it's "available" (still belongs to this org)
      setUsernameAvailable(true);
      return;
    }

    if (value.length < 3) {
      setUsernameAvailable(null);
      return;
    }

    // Same as the create form: a reserved username is answered in words,
    // not just with the red icon a taken username also gets.
    if (isReservedOrganizationSlug(value)) {
      setUsernameAvailable(false);
      form.setError("username", {
        type: "manual",
        message: usernameUnavailableMessage(true),
      });
      return;
    }

    setCheckingUsername(true);
    try {
      const isAvailable = await checkUsernameAvailability(value);
      setUsernameAvailable(isAvailable);
    } catch (error) {
      console.error("Error checking username:", error);
      setUsernameAvailable(false);
    } finally {
      setCheckingUsername(false);
    }
  };

  // Handle logo upload
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error("File size exceeds 5 MB. Please upload a smaller image.");
      return;
    }

    const fileUrl = URL.createObjectURL(file);
    setTempImageUrl(fileUrl);
    setShowCropper(true);
  };

  const handleCropComplete = async (croppedImage: string) => {
    setIsUploading(true);
    try {
      // Update local preview
      form.setValue("logoUrl", croppedImage, { shouldDirty: true });
      // Immediately upload and update organization logo
      const values = form.getValues();
      const result = await updateOrganization({
        id: organization.id,
        name: values.name,
        username: values.username,
        description: values.description,
        website: values.website,
        type: values.type,
        logoUrl: croppedImage,
      });
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Logo updated successfully!");
        router.refresh();
      }
    } catch (error) {
      console.error("Error uploading logo:", error);
      toast.error("Failed to upload logo. Please try again.");
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

  const handleRemoveLogo = () => {
    form.setValue("logoUrl", null, { shouldDirty: true });
    toast.success("Logo removed. Save changes to confirm.");
  };

  // Handle form submission
  const onSubmit = async (data: OrganizationFormValues) => {
    setIsSubmitting(true);

    try {
      // Only check username availability if it changed
      if (data.username !== currentUsername) {
        if (isReservedOrganizationSlug(data.username)) {
          form.setError("username", {
            type: "manual",
            message: usernameUnavailableMessage(true),
          });
          setIsSubmitting(false);
          return;
        }

        const isAvailable = await checkUsernameAvailability(data.username);
        if (!isAvailable) {
          form.setError("username", {
            type: "manual",
            message: usernameUnavailableMessage(false),
          });
          setIsSubmitting(false);
          return;
        }
      }

      const result = await updateOrganization({
        ...data,
        id: organization.id,
        description: data.description || "",
        website: data.website || "",
        logoUrl:
          data.logoUrl === undefined ? organization.logo_url : data.logoUrl,
        autoJoinDomain: organization.auto_join_domain ?? null,
        showMembersPublicly: data.showMembersPublicly,
      });

      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success("Organization updated successfully!");

      // Navigate to the updated organization page after a short delay
      setTimeout(() => {
        router.push(`/organization/${data.username}`);
        router.refresh();
      }, 1000);
    } catch (error) {
      console.error("Error updating organization:", error);
      toast.error("Failed to update organization. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <Card>
          <CardHeader>
            <CardTitle>Organization Logo</CardTitle>
            <CardDescription>
              Upload a logo to represent your organization
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Controller
              control={form.control}
              name="logoUrl"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
                    <Avatar className="w-24 h-24">
                      <AvatarImage
                        src={field.value || undefined}
                        alt="Organization logo"
                      />
                      <AvatarFallback>
                        <Building2 className="h-10 w-10 text-muted-foreground" />
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex gap-2">
                      <input
                        id="logo-upload"
                        type="file"
                        className="hidden"
                        accept="image/jpeg,image/png,image/jpg,image/webp"
                        onChange={handleImageUpload}
                        disabled={isUploading}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          document.getElementById("logo-upload")?.click()
                        }
                        disabled={isUploading}
                      >
                        {isUploading ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Uploading...
                          </>
                        ) : (
                          <>
                            <Upload className="mr-2 h-4 w-4" />
                            {field.value ? "Change Logo" : "Upload Logo"}
                          </>
                        )}
                      </Button>
                      {field.value && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={handleRemoveLogo}
                          disabled={isUploading}
                        >
                          <X className="mr-2 h-4 w-4" />
                          Remove
                        </Button>
                      )}
                    </div>
                  </div>
                  <FieldDescription className="mt-2">
                    Recommended: Square image of at least 200×200px, max 5MB
                  </FieldDescription>
                  {fieldState.invalid && (
                    <FormMessage errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Basic Information</CardTitle>
            <CardDescription>
              Update your organization&apos;s basic details
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <Controller
              control={form.control}
              name="name"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>
                    Organization Name
                  </FieldLabel>
                  <Input
                    id={field.name}
                    {...field}
                    placeholder="Enter organization name"
                    maxLength={NAME_MAX_LENGTH}
                    aria-invalid={fieldState.invalid}
                  />
                  <FieldDescription>
                    This is your organization&apos;s display name
                  </FieldDescription>
                  {fieldState.invalid && (
                    <FormMessage errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="username"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>Username</FieldLabel>
                  <div className="relative">
                    <Input
                      id={field.name}
                      {...field}
                      placeholder="Enter organization username"
                      maxLength={USERNAME_MAX_LENGTH}
                      onChange={(e) => {
                        const noSpaces = e.target.value.replace(/\s/g, "");
                        field.onChange(noSpaces);
                        // Clear errors and reset availability when typing
                        if (form.formState.errors.username) {
                          form.clearErrors("username");
                        }
                        setUsernameAvailable(null);
                      }}
                      onBlur={(e) => {
                        field.onBlur();
                        handleUsernameBlur(e.target.value);
                      }}
                      aria-invalid={fieldState.invalid}
                    />
                    {checkingUsername && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
                      </div>
                    )}
                    {usernameAvailable !== null && !checkingUsername && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        {usernameAvailable ? (
                          <CheckCircle2 className="h-5 w-5 text-primary" />
                        ) : (
                          <AlertCircle className="h-5 w-5 text-destructive" />
                        )}
                      </div>
                    )}
                  </div>
                  <FieldDescription>
                    Used in your organization&apos;s URL:
                    lets-assist.com/organization/
                    <span className="font-mono">
                      {field.value || "username"}
                    </span>
                  </FieldDescription>
                  {fieldState.invalid && (
                    <FormMessage errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="description"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <div className="flex justify-between items-center">
                    <FieldLabel htmlFor={field.name}>Description</FieldLabel>
                    <span className="text-xs text-muted-foreground">
                      {descriptionLength}/{DESCRIPTION_MAX_LENGTH}
                    </span>
                  </div>
                  <Textarea
                    id={field.name}
                    {...field}
                    placeholder="Describe your organization"
                    className="resize-none"
                    rows={4}
                    maxLength={DESCRIPTION_MAX_LENGTH}
                    onChange={(e) => {
                      field.onChange(e);
                      setDescriptionLength(e.target.value.length);
                    }}
                    aria-invalid={fieldState.invalid}
                  />
                  <FieldDescription>
                    A brief description of your organization
                  </FieldDescription>
                  {fieldState.invalid && (
                    <FormMessage errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="website"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>Website</FieldLabel>
                  <div className="relative">
                    <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id={field.name}
                      {...field}
                      placeholder="https://your-website.com"
                      className="pl-10"
                      maxLength={WEBSITE_MAX_LENGTH}
                      onBlur={(e) => {
                        const value = e.target.value.trim();
                        if (
                          value &&
                          !value.startsWith("https://") &&
                          !value.startsWith("http://")
                        ) {
                          field.onChange(`https://${value}`);
                        }
                      }}
                      aria-invalid={fieldState.invalid}
                    />
                  </div>
                  <FieldDescription>
                    Optional. Must start with https:// or http://
                  </FieldDescription>
                  {fieldState.invalid && (
                    <FormMessage errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="type"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>
                    Organization Type
                  </FieldLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger
                      id={field.name}
                      className={cn(
                        "w-full",
                        !field.value && "text-muted-foreground",
                      )}
                      aria-invalid={fieldState.invalid}
                    >
                      <SelectValue placeholder="Select organization type">
                        {field.value
                          ? ORG_TYPE_LABELS[field.value]
                          : "Select organization type"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="nonprofit">
                          Nonprofit Organization
                        </SelectItem>
                        <SelectItem value="school">
                          Educational Institution
                        </SelectItem>
                        <SelectItem value="company">
                          Company/Business
                        </SelectItem>
                        <SelectItem value="government">
                          Government Agency
                        </SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    Choose the type that best describes your organization
                  </FieldDescription>
                  {fieldState.invalid && (
                    <FormMessage errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
            {/* Automatic domain membership is a verified support workflow. */}
            <div className="rounded-lg border bg-muted/30 p-4">
              <p className="text-sm font-medium">Automatic domain membership</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {organization.auto_join_domain
                  ? `Verified domain: ${organization.auto_join_domain}. Contact Let's Assist support to change or disable it.`
                  : "No verified domain is configured. Contact Let&apos;s Assist support after organization verification to enable one."}
              </p>
            </div>
            {/* Member Visibility Section */}
            <div className="space-y-4 rounded-lg border p-4 bg-muted/30">
              <Controller
                control={form.control}
                name="showMembersPublicly"
                render={({ field, fieldState }) => (
                  <Field
                    data-invalid={fieldState.invalid}
                    className="flex flex-row items-center justify-between"
                  >
                    <div className="space-y-0.5">
                      <FieldLabel htmlFor={field.name} className="text-base">
                        Show Members Publicly
                      </FieldLabel>
                      <FieldDescription>
                        Allow visitors to see the list of organization members
                      </FieldDescription>
                    </div>
                    <Switch
                      id={field.name}
                      checked={field.value ?? true}
                      onCheckedChange={field.onChange}
                      aria-invalid={fieldState.invalid}
                    />
                  </Field>
                )}
              />
            </div>{" "}
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button
              type="submit"
              className="ml-auto"
              disabled={
                isSubmitting ||
                !hasChanges ||
                (formValues.username !== organization.username &&
                  !usernameAvailable)
              }
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Changes"
              )}
            </Button>
          </CardFooter>
        </Card>
      </form>

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
