"use client";

import { useState, useEffect } from "react";
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
  Info
} from "lucide-react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
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
import { updateOrganization, checkUsernameAvailability, checkDomainAvailability } from "./actions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import ImageCropper from "@/components/shared/ImageCropper";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Organization } from "@/types";

// Constants
const USERNAME_MAX_LENGTH = 32;
const NAME_MAX_LENGTH = 64;
const WEBSITE_MAX_LENGTH = 100;
const DESCRIPTION_MAX_LENGTH = 650;
const USERNAME_REGEX = /^[a-zA-Z0-9_.-]+$/;
const normalizeDomain = (value: string | null | undefined) => (value ?? "").toLowerCase().trim();

const ORG_TYPE_LABELS: Record<string, string> = {
  nonprofit: "Nonprofit Organization",
  school: "Educational Institution",
  company: "Company/Business",
  government: "Government Agency",
  other: "Other",
};

const ORG_TYPE_OPTIONS = ["nonprofit", "school", "company", "government", "other"] as const;
type OrganizationTypeOption = (typeof ORG_TYPE_OPTIONS)[number];

// Form schema
const orgUpdateSchema = z.object({
  name: z.string()
    .min(2, "Name must be at least 2 characters")
    .max(NAME_MAX_LENGTH, `Name cannot exceed ${NAME_MAX_LENGTH} characters`),

  username: z.string()
    .min(3, "Username must be at least 3 characters")
    .max(USERNAME_MAX_LENGTH, `Username cannot exceed ${USERNAME_MAX_LENGTH} characters`)
    .regex(USERNAME_REGEX, "Username can only contain letters, numbers, underscores, dots and hyphens"),

  description: z.string()
    .max(DESCRIPTION_MAX_LENGTH, `Description cannot exceed ${DESCRIPTION_MAX_LENGTH} characters`)
    .optional(),

  website: z.string()
    .max(WEBSITE_MAX_LENGTH, `Website URL cannot exceed ${WEBSITE_MAX_LENGTH} characters`)
    .url("Please enter a valid URL")
    .optional()
    .or(z.literal("")),

  type: z.enum(["nonprofit", "school", "company", "government", "other"]),

  logoUrl: z.string().optional().nullable(),

  enableAutoJoin: z.boolean().optional(),

  autoJoinDomain: z.string()
    .optional()
    .refine(
      (val) =>
        !val ||
        /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/.test(val),
      "Please enter a valid domain (e.g., example.org)"
    ),
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
};

export default function EditOrganizationForm({ organization, userId: _userId }: EditOrganizationFormProps) {
  const router = useRouter();
  const resolvedOrgType: OrganizationTypeOption = ORG_TYPE_OPTIONS.includes(
    organization.type as OrganizationTypeOption
  )
    ? (organization.type as OrganizationTypeOption)
    : "nonprofit";
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [domainAvailable, setDomainAvailable] = useState<boolean | null>(null);
  const [checkingDomain, setCheckingDomain] = useState(false);
  const [tempImageUrl, setTempImageUrl] = useState<string>("");
  const [showCropper, setShowCropper] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [descriptionLength, setDescriptionLength] = useState(
    organization.description?.length || 0
  );
  const [hasChanges, setHasChanges] = useState(false);

  // Setup form with initial values from organization
  const form = useForm<OrganizationFormValues>({
    resolver: zodResolver(orgUpdateSchema),
    defaultValues: {
      name: organization.name || "",
      username: organization.username || "",
      description: organization.description || "",
      website: organization.website || "",
      type: resolvedOrgType,
      logoUrl: organization.logo_url || null,
      enableAutoJoin: !!organization.auto_join_domain,
      autoJoinDomain: organization.auto_join_domain || "",
    },
  });

  // Watch enableAutoJoin for conditional rendering
  const enableAutoJoin = form.watch("enableAutoJoin");

  // Watch all form values and detect changes more reliably
  const formValues = form.watch();

  useEffect(() => {
    const subscription = form.watch((value) => {
      // Check if any field has changed from initial values
      const hasFormChanges = Object.keys(value).some(key => {
        const orgKey = (key === "logoUrl" ? "logo_url" : key) as keyof OrganizationWithSettings;
        const initialValue = organization[orgKey];
        const currentValue = value[key as keyof OrganizationFormValues];

        // Handle empty strings and null values
        if (!initialValue && !currentValue) return false;
        if (!initialValue && currentValue === "") return false;
        if (!currentValue && initialValue === "") return false;

        return initialValue !== currentValue;
      });

      setHasChanges(hasFormChanges);
    });

    return () => subscription.unsubscribe();
  }, [form, organization]);

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

  // Check if domain is available when changed
  const currentDomain = organization.auto_join_domain;

  const handleDomainBlur = async (value: string) => {
    const normalizedValue = normalizeDomain(value);
    if (!normalizedValue) {
      setDomainAvailable(null);
      return;
    }

    if (normalizedValue === normalizeDomain(currentDomain)) {
      // Domain hasn't changed, so it's "available" (still belongs to this org)
      setDomainAvailable(true);
      return;
    }

    setCheckingDomain(true);
    try {
      const isAvailable = await checkDomainAvailability(normalizedValue, organization.id);
      setDomainAvailable(isAvailable);
    } catch (error) {
      console.error("Error checking domain:", error);
      setDomainAvailable(false);
    } finally {
      setCheckingDomain(false);
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
        const isAvailable = await checkUsernameAvailability(data.username);
        if (!isAvailable) {
          form.setError("username", {
            type: "manual",
            message: "Username is already taken",
          });
          setIsSubmitting(false);
          return;
        }
      }

      // Check domain availability if auto-join is enabled and domain changed
      const newDomain = data.enableAutoJoin ? normalizeDomain(data.autoJoinDomain) : null;
      if (newDomain && newDomain !== normalizeDomain(currentDomain)) {
        const isDomainAvailable = await checkDomainAvailability(newDomain, organization.id);
        if (!isDomainAvailable) {
          form.setError("autoJoinDomain", {
            type: "manual",
            message: "This domain is already in use by another organization",
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
        logoUrl: data.logoUrl === undefined ? organization.logo_url : data.logoUrl,
        autoJoinDomain: newDomain || null,
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
                        onClick={() => document.getElementById('logo-upload')?.click()}
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
                  {fieldState.invalid && <FormMessage errors={[fieldState.error]} />}
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
                  <FieldLabel htmlFor={field.name}>Organization Name</FieldLabel>
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
                  {fieldState.invalid && <FormMessage errors={[fieldState.error]} />}
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
                    Used in your organization&apos;s URL: lets-assist.com/organization/<span className="font-mono">{field.value || "username"}</span>
                  </FieldDescription>
                  {fieldState.invalid && <FormMessage errors={[fieldState.error]} />}
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
                  {fieldState.invalid && <FormMessage errors={[fieldState.error]} />}
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
                        if (value && !value.startsWith('https://') && !value.startsWith('http://')) {
                          field.onChange(`https://${value}`);
                        }
                      }}
                      aria-invalid={fieldState.invalid}
                    />
                  </div>
                  <FieldDescription>
                    Optional. Must start with https:// or http://
                  </FieldDescription>
                  {fieldState.invalid && <FormMessage errors={[fieldState.error]} />}
                </Field>
              )}
            />

            <Controller
              control={form.control}
              name="type"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>Organization Type</FieldLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value}
                  >
                    <SelectTrigger
                      id={field.name}
                      className={cn(
                        "w-full",
                        !field.value && "text-muted-foreground"
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
                        <SelectItem value="nonprofit">Nonprofit Organization</SelectItem>
                        <SelectItem value="school">Educational Institution</SelectItem>
                        <SelectItem value="company">Company/Business</SelectItem>
                        <SelectItem value="government">Government Agency</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    Choose the type that best describes your organization
                  </FieldDescription>
                  {fieldState.invalid && <FormMessage errors={[fieldState.error]} />}
                </Field>
              )}
            />

            {/* Auto-join by Email Domain Section */}
            <div className="space-y-4 rounded-lg border p-4 bg-muted/30">
              <Controller
                control={form.control}
                name="enableAutoJoin"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid} className="flex flex-row items-center justify-between">
                    <div className="space-y-0.5">
                      <FieldLabel htmlFor={field.name} className="text-base">Auto-join by Email Domain</FieldLabel>
                      <FieldDescription>
                        Allow users with matching email domains to join automatically
                      </FieldDescription>
                    </div>
                    <Switch
                      id={field.name}
                      checked={field.value}
                      onCheckedChange={(checked) => {
                        field.onChange(checked);
                        if (!checked) {
                          form.setValue("autoJoinDomain", "");
                          setDomainAvailable(null);
                        }
                      }}
                      aria-invalid={fieldState.invalid}
                    />
                  </Field>
                )}
              />

              {enableAutoJoin && (
                <Controller
                  control={form.control}
                  name="autoJoinDomain"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={field.name}>Email Domain</FieldLabel>
                      <div className="relative">
                        <Input
                          id={field.name}
                          placeholder="example.org"
                          {...field}
                          onBlur={(e) => handleDomainBlur(e.target.value)}
                          className="pr-10"
                          aria-invalid={fieldState.invalid}
                        />
                        {checkingDomain && (
                          <Loader2 className="absolute right-3 top-3 h-4 w-4 animate-spin text-muted-foreground" />
                        )}
                        {!checkingDomain && domainAvailable === true && (
                          <CheckCircle2 className="absolute right-3 top-3 h-4 w-4 text-green-500" />
                        )}
                        {!checkingDomain && domainAvailable === false && (
                          <AlertCircle className="absolute right-3 top-3 h-4 w-4 text-destructive" />
                        )}
                      </div>
                      <FieldDescription className="flex items-start gap-1.5">
                        <Info className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
                        <span>
                          Users with verified email addresses from this domain (e.g., @example.org) will be able to join your organization instantly without approval.
                        </span>
                      </FieldDescription>
                      {fieldState.invalid && <FormMessage errors={[fieldState.error]} />}
                      {!checkingDomain && domainAvailable === false && (
                        <p className="text-sm text-destructive">
                          This domain is already in use by another organization.
                        </p>
                      )}
                    </Field>
                  )}
                />
              )}
            </div>
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button
              type="submit"
              className="ml-auto"
              disabled={
                isSubmitting ||
                !hasChanges ||
                (formValues.username !== organization.username && !usernameAvailable)
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
