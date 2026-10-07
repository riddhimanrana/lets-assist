"use client";

import { useState, useEffect, useMemo } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { SettingsSection } from "@/components/layout/SettingsSection";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { updateOrganization, checkUsernameAvailability } from "./actions";
import {
  isReservedOrganizationSlug,
  usernameUnavailableMessage,
} from "@/lib/organization/reserved-slugs";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import ImageCropper from "@/components/shared/ImageCropper";
import { organizationUsernameSchema } from "@/lib/organization/username";

import { hasOrganizationFormChanges } from "./organization-form-change";
import {
  ORG_TYPE_OPTIONS,
  orgUpdateSchema,
  type OrganizationFormValues,
  type OrganizationTypeOption,
  type OrganizationWithSettings,
} from "./organization-form-schema";
import OrganizationProfileFields from "./OrganizationProfileFields";

interface EditOrganizationFormProps {
  organization: OrganizationWithSettings;
  userId: string;
  /**
   * Which part of the organization form to show. Both parts submit the whole
   * organization record through the same action, so a save from either one
   * sends every field.
   */
  section?: "general" | "members";
}

export default function EditOrganizationForm({
  organization,
  userId: _userId,
  section = "general",
}: EditOrganizationFormProps) {
  const router = useRouter();
  const resolvedOrgType: OrganizationTypeOption = ORG_TYPE_OPTIONS.includes(
    organization.type as OrganizationTypeOption,
  )
    ? (organization.type as OrganizationTypeOption)
    : "nonprofit";
  const updateSchema = useMemo(
    () =>
      orgUpdateSchema.extend({
        username: z.union([
          organizationUsernameSchema,
          z.literal(organization.username),
        ]),
      }),
    [organization.username],
  );
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
    resolver: zodResolver(updateSchema),
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

  const saveButton = (
    <Button
      type="submit"
      disabled={
        isSubmitting ||
        !hasChanges ||
        (formValues.username !== organization.username && !usernameAvailable)
      }
    >
      {isSubmitting ? (
        <>
          <Loader2 className="animate-spin" />
          Saving...
        </>
      ) : (
        "Save changes"
      )}
    </Button>
  );
  const saveHint = hasChanges ? "You have unsaved changes." : undefined;

  return (
    <>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        {section === "general" ? (
          <SettingsSection
            title="Profile"
            description="How your organization appears across Let's Assist."
            contentClassName="gap-6"
            footer={saveButton}
            footerHint={saveHint}
          >
            <OrganizationProfileFields
              form={form}
              isUploading={isUploading}
              checkingUsername={checkingUsername}
              usernameAvailable={usernameAvailable}
              descriptionLength={descriptionLength}
              onImageUpload={handleImageUpload}
              onRemoveLogo={handleRemoveLogo}
              onUsernameEdited={() => setUsernameAvailable(null)}
              onUsernameBlur={handleUsernameBlur}
              onDescriptionLengthChange={setDescriptionLength}
            />
          </SettingsSection>
        ) : (
          <SettingsSection
            title="Member visibility"
            description="Choose whether people outside the organization can see who belongs to it."
            footer={saveButton}
            footerHint={saveHint}
          >
            <Controller
              control={form.control}
              name="showMembersPublicly"
              render={({ field, fieldState }) => (
                <Field
                  orientation="horizontal"
                  data-invalid={fieldState.invalid}
                >
                  <FieldContent>
                    <FieldLabel htmlFor={field.name}>
                      Show members publicly
                    </FieldLabel>
                    <FieldDescription>
                      Allow visitors to see the list of organization members
                    </FieldDescription>
                    {fieldState.invalid && (
                      <FieldError errors={[fieldState.error]} />
                    )}
                  </FieldContent>
                  <Switch
                    id={field.name}
                    checked={field.value ?? true}
                    onCheckedChange={field.onChange}
                    aria-invalid={fieldState.invalid}
                  />
                </Field>
              )}
            />
          </SettingsSection>
        )}
      </form>

      <Dialog open={showCropper} onOpenChange={setShowCropper}>
        <DialogContent className="sm:max-w-md">
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
