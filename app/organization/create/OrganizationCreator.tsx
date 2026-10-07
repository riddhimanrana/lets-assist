"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Building2,
  Globe,
  Info,
  Upload,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { SettingsSection } from "@/components/layout/SettingsSection";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectGroup,
} from "@/components/ui/select";
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError as FormMessage,
} from "@/components/ui/field";
import { Controller } from "react-hook-form";
import { createOrganization, checkOrgUsername } from "./actions";
import {
  isReservedOrganizationSlug,
  usernameUnavailableMessage,
} from "@/lib/organization/reserved-slugs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import ImageCropper from "@/components/shared/ImageCropper";
import {
  ORGANIZATION_USERNAME_MAX_LENGTH,
  ORGANIZATION_USERNAME_MIN_LENGTH,
  organizationUsernameSchema,
} from "@/lib/organization/username";

// Constants for form validation
const CONSTANTS = {
  NAME: {
    MIN: 3,
    MAX: 64,
  },
  USERNAME: {
    MIN: ORGANIZATION_USERNAME_MIN_LENGTH,
    MAX: ORGANIZATION_USERNAME_MAX_LENGTH,
  },
  WEBSITE: {
    MAX: 100,
  },
  DESCRIPTION: {
    MIN: 10,
    MAX: 650,
  },
} as const;

const ORG_TYPE_LABELS: Record<OrganizationFormValues["type"], string> = {
  nonprofit: "Nonprofit Organization",
  school: "Educational Institution",
  company: "Company/Business",
  government: "Government Agency",
  other: "Other",
};

// Form schema with enhanced validation
const orgCreationSchema = z.object({
  name: z
    .string()
    .min(
      CONSTANTS.NAME.MIN,
      `Name must be at least ${CONSTANTS.NAME.MIN} characters`,
    )
    .max(
      CONSTANTS.NAME.MAX,
      `Name cannot exceed ${CONSTANTS.NAME.MAX} characters`,
    )
    .refine((value) => value.trim().length >= CONSTANTS.NAME.MIN, {
      message: "Name cannot be only whitespace",
    }),

  username: organizationUsernameSchema,

  description: z
    .string()
    .min(
      CONSTANTS.DESCRIPTION.MIN,
      `Description must be at least ${CONSTANTS.DESCRIPTION.MIN} characters`,
    )
    .max(
      CONSTANTS.DESCRIPTION.MAX,
      `Description cannot exceed ${CONSTANTS.DESCRIPTION.MAX} characters`,
    )
    .refine((value) => value.trim().length >= CONSTANTS.DESCRIPTION.MIN, {
      message: "Description cannot be only whitespace",
    }),

  website: z
    .string()
    .max(
      CONSTANTS.WEBSITE.MAX,
      `Website URL cannot exceed ${CONSTANTS.WEBSITE.MAX} characters`,
    )
    .url("Please enter a valid URL")
    .optional()

    .or(z.literal("")),

  type: z.enum([
    "nonprofit",
    "school",
    "company",
    "government",
    "other",
  ] as const),

  logoUrl: z.string().nullable().optional(),
});

type OrganizationFormValues = z.infer<typeof orgCreationSchema>;

export default function OrganizationCreator({ userId }: { userId: string }) {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(
    null,
  );
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [tempImageUrl, setTempImageUrl] = useState<string>("");
  const [showCropper, setShowCropper] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<OrganizationFormValues>({
    resolver: zodResolver(orgCreationSchema),
    defaultValues: {
      name: "",
      username: "",
      description: "",
      website: "",
      type: "nonprofit",
      logoUrl: null,
    },
  });

  // Track character counts.
  const nameLength = form.watch("name")?.length || 0;
  const descriptionLength = form.watch("description")?.length || 0;

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
    form.setValue("logoUrl", croppedImage);
    setIsUploading(false);
    setShowCropper(false);
  };

  const handleCropCancel = () => {
    setShowCropper(false);
    setTempImageUrl("");
  };

  const checkUsernameAvailability = async (username: string) => {
    if (username.length < 3) {
      setUsernameAvailable(null);
      return;
    }

    setCheckingUsername(true);
    try {
      const isAvailable = await checkOrgUsername(username);
      setUsernameAvailable(isAvailable);
    } catch (error) {
      console.error("Error checking username:", error);
      toast.error("Failed to check username availability");
    } finally {
      setCheckingUsername(false);
    }
  };

  const onSubmit = async (data: OrganizationFormValues) => {
    setIsCreating(true);
    try {
      const result = await createOrganization({
        name: data.name,
        username: data.username,
        description: data.description || "",
        website: data.website || "",
        type: data.type,
        logoUrl: data.logoUrl || null,
        createdBy: userId,
      });

      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success("Organization created successfully!");
      router.push(`/organization/${data.username}`);
    } catch (error) {
      console.error("Error creating organization:", error);
      toast.error("Failed to create organization. Please try again.");
    } finally {
      setIsCreating(false);
    }
  };

  const logoUrl = form.watch("logoUrl");

  return (
    <>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <SettingsSection
          title="Organization profile"
          description="This is what people see on your organization page. You can change it later in settings."
          contentClassName="gap-6"
          footer={
            <>
              <Button variant="ghost" asChild>
                <Link href="/organization">Cancel</Link>
              </Button>
              <Button
                type="submit"
                disabled={
                  isCreating ||
                  !usernameAvailable ||
                  !form.formState.isValid ||
                  Object.keys(form.formState.errors).length > 0
                }
              >
                {isCreating ? (
                  <>
                    <Spinner data-icon="inline-start" />
                    Creating...
                  </>
                ) : (
                  "Create Organization"
                )}
              </Button>
            </>
          }
        >
          <div className="flex items-center gap-4">
            <Avatar className="size-16">
              <AvatarImage src={logoUrl || undefined} alt="Organization logo" />
              <AvatarFallback className="bg-muted">
                <Building2 className="text-muted-foreground size-6" />
              </AvatarFallback>
            </Avatar>
            <div className="grid gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => logoInputRef.current?.click()}
                >
                  <Upload data-icon="inline-start" />
                  {logoUrl ? "Change logo" : "Upload logo"}
                </Button>
                {logoUrl ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      form.setValue("logoUrl", null);
                      if (logoInputRef.current) logoInputRef.current.value = "";
                    }}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
              <input
                ref={logoInputRef}
                id="logo-upload"
                type="file"
                className="hidden"
                accept="image/jpeg,image/png,image/jpg"
                onChange={handleImageUpload}
              />
              <p className="text-muted-foreground text-sm">
                Optional, but recommended. Square JPG or PNG, up to 5 MB.
              </p>
            </div>
          </div>

          <Controller
            control={form.control}
            name="name"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={field.name}>
                  Organization Name *
                </FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    id={field.name}
                    {...field}
                    placeholder="Enter organization name"
                    maxLength={CONSTANTS.NAME.MAX}
                    aria-invalid={
                      fieldState.invalid ||
                      Boolean(
                        field.value && field.value.length < CONSTANTS.NAME.MIN,
                      )
                    }
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupText className="text-xs tabular-nums">
                      {nameLength}/{CONSTANTS.NAME.MAX}
                    </InputGroupText>
                  </InputGroupAddon>
                </InputGroup>
                <FieldDescription>
                  This will be your organization&apos;s display name (minimum{" "}
                  {CONSTANTS.NAME.MIN} characters)
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
                <FieldLabel htmlFor={field.name}>Username *</FieldLabel>
                <InputGroup>
                  <InputGroupAddon>
                    <InputGroupText>@</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput
                    id={field.name}
                    {...field}
                    placeholder="Enter organization username"
                    maxLength={CONSTANTS.USERNAME.MAX}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
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
                      // A reserved username is not "taken" and never
                      // becomes available, so it is answered here without
                      // a round trip -- and answered in words, not just
                      // with the same red icon a taken username gets,
                      // since the submit button is disabled either way.
                      if (isReservedOrganizationSlug(e.target.value)) {
                        setUsernameAvailable(false);
                        form.setError("username", {
                          type: "manual",
                          message: usernameUnavailableMessage(true),
                        });
                        field.onBlur();
                        return;
                      }
                      field.onBlur();
                      checkUsernameAvailability(e.target.value);
                    }}
                    aria-invalid={fieldState.invalid}
                  />
                  {checkingUsername ? (
                    <InputGroupAddon align="inline-end">
                      <Spinner aria-label="Checking username" />
                    </InputGroupAddon>
                  ) : usernameAvailable !== null ? (
                    <InputGroupAddon align="inline-end">
                      {usernameAvailable ? (
                        <CheckCircle2
                          role="img"
                          aria-label="Username available"
                          className="text-success"
                        />
                      ) : (
                        <AlertCircle
                          role="img"
                          aria-label="Username unavailable"
                          className="text-destructive"
                        />
                      )}
                    </InputGroupAddon>
                  ) : null}
                </InputGroup>
                <FieldDescription>
                  Used in your organization&apos;s URL (minimum 3 characters):
                  lets-assist.com/organization/
                  <span className="font-mono">{field.value || "username"}</span>
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
                  Organization Type *
                </FieldLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger
                    id={field.name}
                    aria-invalid={fieldState.invalid}
                  >
                    <SelectValue placeholder="Select organization type">
                      {field.value ? ORG_TYPE_LABELS[field.value] : null}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {Object.entries(ORG_TYPE_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
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

          <Controller
            control={form.control}
            name="website"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={field.name}>Website</FieldLabel>
                <InputGroup>
                  <InputGroupAddon>
                    <Globe />
                  </InputGroupAddon>
                  <InputGroupInput
                    id={field.name}
                    {...field}
                    placeholder="https://your-website.com"
                    maxLength={CONSTANTS.WEBSITE.MAX}
                    aria-invalid={fieldState.invalid}
                  />
                </InputGroup>
                <FieldDescription>
                  Optional. Include your organization&apos;s website. Must start
                  with https:// or http://
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
                <FieldLabel htmlFor={field.name}>Description *</FieldLabel>
                <InputGroup>
                  <InputGroupTextarea
                    id={field.name}
                    {...field}
                    placeholder="Describe your organization"
                    rows={4}
                    maxLength={CONSTANTS.DESCRIPTION.MAX}
                    aria-invalid={
                      fieldState.invalid ||
                      Boolean(
                        field.value &&
                        field.value.length < CONSTANTS.DESCRIPTION.MIN,
                      )
                    }
                  />
                  <InputGroupAddon align="block-end" className="justify-end">
                    <InputGroupText className="text-xs tabular-nums">
                      {descriptionLength}/{CONSTANTS.DESCRIPTION.MAX}
                    </InputGroupText>
                  </InputGroupAddon>
                </InputGroup>
                <FieldDescription>
                  Provide a short description of your organization (minimum{" "}
                  {CONSTANTS.DESCRIPTION.MIN} characters)
                </FieldDescription>
                {fieldState.invalid && (
                  <FormMessage errors={[fieldState.error]} />
                )}
              </Field>
            )}
          />

          <Alert>
            <Info />
            <AlertTitle>Automatic domain membership</AlertTitle>
            <AlertDescription>
              Organization-owned email domains can be enabled after Let&apos;s
              Assist verifies the organization. Create the organization first,
              then use its settings page to contact support.
            </AlertDescription>
          </Alert>
        </SettingsSection>
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
