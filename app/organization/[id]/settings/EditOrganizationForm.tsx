"use client";

import type { Organization } from "@/types";
import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { 
  Building2, 
  Globe,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Upload,
  X
} from "lucide-react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { updateOrganization, checkUsernameAvailability } from "./actions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import ImageCropper from "@/components/ImageCropper";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";

// Constants
const USERNAME_MAX_LENGTH = 32;
const NAME_MAX_LENGTH = 64;
const WEBSITE_MAX_LENGTH = 100;
const DESCRIPTION_MAX_LENGTH = 650;
const USERNAME_REGEX = /^[a-zA-Z0-9_.-]+$/;

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
});

type OrganizationFormValues = z.infer<typeof orgUpdateSchema>;

interface EditOrganizationFormProps {
  organization: Organization;
  _userId: string;
}

export default function EditOrganizationForm({ organization, _userId }: EditOrganizationFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);
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
      type: organization.type || "nonprofit",
      logoUrl: organization.logo_url || null,
    },
  });

  // Watch all form values and detect changes more reliably
  const formValues = form.watch();
  
  useEffect(() => {
    const subscription = form.watch((value, { name: _name, type: _type }) => {
      // Check if any field has changed from initial values
      const hasFormChanges = Object.keys(value).some(key => {
        const initialValue = organization[key === 'logoUrl' ? 'logo_url' : key];
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
      
      const result = await updateOrganization({
        ...data,
        id: organization.id,
        description: data.description || "",
        website: data.website || "",
        logoUrl: data.logoUrl === undefined ? organization.logo_url : data.logoUrl,
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
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          <Card>
            <CardHeader>
              <CardTitle>Organization Logo</CardTitle>
              <CardDescription>
                Upload a logo to represent your organization
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FormField
                control={form.control}
                name="logoUrl"
                render={({ field }) => (
                  <FormItem>
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
                    <FormDescription className="mt-2">
                      Recommended: Square image of at least 200×200px, max 5MB
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
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
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Organization Name</FormLabel>
                    <FormControl>
                      <Input 
                        {...field} 
                        placeholder="Enter organization name"
                        maxLength={NAME_MAX_LENGTH}
                      />
                    </FormControl>
                    <FormDescription>
                      This is your organization&apos;s display name
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
                    <FormLabel>Username</FormLabel>
                    <div className="relative">
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="Enter organization username"
                          maxLength={USERNAME_MAX_LENGTH}
                          onChange={(e) => {
                            const noSpaces = e.target.value.replace(/\s/g, "");
                            field.onChange(noSpaces);
                          }}
                          onBlur={(e) => {
                            field.onBlur();
                            handleUsernameBlur(e.target.value);
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
                            <CheckCircle2 className="h-5 w-5 text-primary" />
                          ) : (
                            <AlertCircle className="h-5 w-5 text-destructive" />
                          )}
                        </div>
                      )}
                    </div>
                    <FormDescription>
                      Used in your organization&apos;s URL: lets-assist.com/organization/<span className="font-mono">{field.value || "username"}</span>
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex justify-between items-center">
                      <FormLabel>Description</FormLabel>
                      <span className="text-xs text-muted-foreground">
                        {descriptionLength}/{DESCRIPTION_MAX_LENGTH}
                      </span>
                    </div>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder="Describe your organization"
                        className="resize-none"
                        rows={4}
                        maxLength={DESCRIPTION_MAX_LENGTH}
                        onChange={(e) => {
                          field.onChange(e);
                          setDescriptionLength(e.target.value.length);
                        }}
                      />
                    </FormControl>
                    <FormDescription>
                      A brief description of your organization
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="website"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Website</FormLabel>
                    <div className="relative">
                      <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <FormControl>
                        <Input
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
                        />
                      </FormControl>
                    </div>
                    <FormDescription>
                      Optional. Must start with https:// or http://
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Organization Type</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger 
                          data-empty={!field.value}
                          className="data-[empty=true]:text-muted-foreground"
                        >
                          <SelectValue placeholder="Select organization type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectGroup>
                          <SelectLabel>Type</SelectLabel>
                          <SelectItem value="nonprofit">Nonprofit Organization</SelectItem>
                          <SelectItem value="school">Educational Institution</SelectItem>
                          <SelectItem value="company">Company/Business</SelectItem>
                          <SelectItem value="government">Government Agency</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Choose the type that best describes your organization
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
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
      </Form>

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
