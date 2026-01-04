"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2, Globe, Upload, CheckCircle2, AlertCircle, Loader2, Info } from "lucide-react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem, SelectGroup, SelectLabel } from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { createOrganization, checkOrgUsername, checkDomainAvailability } from "./actions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import ImageCropper from "@/components/shared/ImageCropper";

// Constants for form validation
const CONSTANTS = {
  NAME: {
    MIN: 3,
    MAX: 64,
  },
  USERNAME: {
    MIN: 3,
    MAX: 32,
    REGEX: /^[a-zA-Z0-9_.-]+$/,
  },
  WEBSITE: {
    MAX: 100,
  },
  DESCRIPTION: {
    MIN: 10,
    MAX: 650,
  },
} as const;

// Form schema with enhanced validation
const orgCreationSchema = z.object({
  name: z.string()
    .min(CONSTANTS.NAME.MIN, `Name must be at least ${CONSTANTS.NAME.MIN} characters`)
    .max(CONSTANTS.NAME.MAX, `Name cannot exceed ${CONSTANTS.NAME.MAX} characters`)
    .refine(value => value.trim().length >= CONSTANTS.NAME.MIN, {
      message: "Name cannot be only whitespace"
    }),

  username: z.string()
    .min(CONSTANTS.USERNAME.MIN, `Username must be at least ${CONSTANTS.USERNAME.MIN} characters`)
    .max(CONSTANTS.USERNAME.MAX, `Username cannot exceed ${CONSTANTS.USERNAME.MAX} characters`)
    .regex(CONSTANTS.USERNAME.REGEX, {
      message: "Username can only contain letters, numbers, underscores, dots and hyphens"
    })
    .refine(value => !value.includes(".."), {
      message: "Username cannot contain consecutive dots"
    })
    .refine(value => !value.startsWith(".") && !value.endsWith("."), {
      message: "Username cannot start or end with a dot"
    }),

  description: z.string()
    .min(CONSTANTS.DESCRIPTION.MIN, `Description must be at least ${CONSTANTS.DESCRIPTION.MIN} characters`)
    .max(CONSTANTS.DESCRIPTION.MAX, `Description cannot exceed ${CONSTANTS.DESCRIPTION.MAX} characters`)
    .refine(value => value.trim().length >= CONSTANTS.DESCRIPTION.MIN, {
      message: "Description cannot be only whitespace"
    }),

  website: z.string()
    .max(CONSTANTS.WEBSITE.MAX, `Website URL cannot exceed ${CONSTANTS.WEBSITE.MAX} characters`)
    .url("Please enter a valid URL")
    .optional()

    .or(z.literal("")),

  type: z.enum(["nonprofit", "school", "company", "government", "other"], {
    required_error: "Please select an organization type",
    invalid_type_error: "Please select a valid organization type",
  }),

  logoUrl: z.string().nullable().optional(),

  autoJoinDomain: z.string()
    .transform(val => val?.toLowerCase().trim())
    .optional()
    .refine(val => !val || /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(val), {
      message: "Please enter a valid domain (e.g., company.com)"
    }),

  enableAutoJoin: z.boolean().optional(),
});

type OrganizationFormValues = z.infer<typeof orgCreationSchema>;

export default function OrganizationCreator({ userId }: { userId: string }) {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [tempImageUrl, setTempImageUrl] = useState<string>("");
  const [showCropper, setShowCropper] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [domainAvailable, setDomainAvailable] = useState<boolean | null>(null);
  const [checkingDomain, setCheckingDomain] = useState(false);

  const form = useForm<OrganizationFormValues>({
    resolver: zodResolver(orgCreationSchema),
    defaultValues: {
      name: "",
      username: "",
      description: "",
      website: "",
      type: undefined, // Remove default value to force selection
      logoUrl: null,
      autoJoinDomain: "",
      enableAutoJoin: false,
    },
  });

  // Track character counts and enableAutoJoin state
  const nameLength = form.watch("name")?.length || 0;
  const usernameLength = form.watch("username")?.length || 0;
  const descriptionLength = form.watch("description")?.length || 0;
  const enableAutoJoin = form.watch("enableAutoJoin");

  const checkDomainAvailabilityHandler = async (domain: string) => {
    if (!domain || domain.length < 3) {
      setDomainAvailable(null);
      return;
    }

    setCheckingDomain(true);
    try {
      const isAvailable = await checkDomainAvailability(domain);
      setDomainAvailable(isAvailable);
    } catch (error) {
      console.error("Error checking domain:", error);
      toast.error("Failed to check domain availability");
    } finally {
      setCheckingDomain(false);
    }
  };

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
    form.setValue("logoUrl", croppedImage);
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
        autoJoinDomain: data.enableAutoJoin && data.autoJoinDomain ? data.autoJoinDomain : undefined,
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

  return (
    <>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          <Card>
            <CardHeader>
              <CardTitle>Basic Information</CardTitle>
              <CardDescription>
                Provide the essential details about your organization
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6 mb-6">
                <Avatar className="w-24 h-24">
                  <AvatarImage src={form.watch("logoUrl") || undefined} alt="Organization logo" />
                  <AvatarFallback className="bg-muted">
                    <Building2 className="h-8 w-8 text-muted-foreground" />
                  </AvatarFallback>
                </Avatar>
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => document.getElementById("logo-upload")?.click()}
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    Upload Logo
                  </Button>
                  <input
                    id="logo-upload"
                    type="file"
                    className="hidden"
                    accept="image/jpeg,image/png,image/jpg"
                    onChange={handleImageUpload}
                  />
                  <p className="text-sm text-muted-foreground mt-2">
                    Optional, but highly recommended. Upload a square logo for your organization.
                  </p>
                </div>
              </div>

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Organization Name *</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          {...field}
                          placeholder="Enter organization name"
                          maxLength={CONSTANTS.NAME.MAX}
                          className={field.value && field.value.length < CONSTANTS.NAME.MIN ? "border-destructive" : ""}
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                          {nameLength}/{CONSTANTS.NAME.MAX}
                        </span>
                      </div>
                    </FormControl>
                    <FormDescription>
                      This will be your organization&apos;s display name (minimum {CONSTANTS.NAME.MIN} characters)
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
                    <FormLabel>Username *</FormLabel>
                    <div className="relative">
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="Enter organization username"
                          maxLength={CONSTANTS.USERNAME.MAX}
                          onChange={(e) => {
                            const noSpaces = e.target.value.replace(/\s/g, "");
                            field.onChange(noSpaces);
                          }}
                          onBlur={(e) => {
                            if (e.target.value.toLowerCase() === "create") {
                              setUsernameAvailable(false);
                              return;
                            }
                            field.onBlur();
                            checkUsernameAvailability(e.target.value);
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
                      Used in your organization&apos;s URL (minimum 3 characters): lets-assist.com/organization/<span className="font-mono">{field.value || "username"}</span>
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
                    <FormLabel>Description *</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Textarea
                          {...field}
                          placeholder="Describe your organization"
                          className={`resize-none ${field.value && field.value.length < CONSTANTS.DESCRIPTION.MIN ? "border-destructive" : ""
                            }`}
                          rows={4}
                          maxLength={CONSTANTS.DESCRIPTION.MAX}
                        />
                        <span className="absolute right-3 bottom-3 text-xs text-muted-foreground">
                          {descriptionLength}/{CONSTANTS.DESCRIPTION.MAX}
                        </span>
                      </div>
                    </FormControl>
                    <FormDescription>
                      Provide a short description of your organization (minimum {CONSTANTS.DESCRIPTION.MIN} characters)
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
                          maxLength={CONSTANTS.WEBSITE.MAX}
                        />
                      </FormControl>
                    </div>
                    <FormDescription>
                      Optional. Include your organization&apos;s website. Must start with https:// or http://
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
                    <FormLabel>Organization Type *</FormLabel>
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
              
              {/* Auto-join domain section */}
              <div className="space-y-4 rounded-lg border p-4 bg-muted/30">
                <FormField
                  control={form.control}
                  name="enableAutoJoin"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">Auto-join by Email Domain</FormLabel>
                        <FormDescription>
                          Automatically add users to this organization when they sign up with a specific email domain
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={(checked) => {
                            field.onChange(checked);
                            if (!checked) {
                              form.setValue("autoJoinDomain", "");
                              setDomainAvailable(null);
                            }
                          }}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                {enableAutoJoin && (
                  <FormField
                    control={form.control}
                    name="autoJoinDomain"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email Domain</FormLabel>
                        <div className="relative">
                          <FormControl>
                            <Input
                              {...field}
                              placeholder="e.g. school.net"
                              onChange={(e) => {
                                const value = e.target.value.toLowerCase().trim();
                                field.onChange(value);
                              }}
                              onBlur={(e) => {
                                field.onBlur();
                                checkDomainAvailabilityHandler(e.target.value);
                              }}
                            />
                          </FormControl>
                          {checkingDomain && (
                            <div className="absolute right-3 top-1/2 -translate-y-1/2">
                              <div className="h-4 w-4 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
                            </div>
                          )}
                          {domainAvailable !== null && !checkingDomain && (
                            <div className="absolute right-3 top-1/2 -translate-y-1/2">
                              {domainAvailable ? (
                                <CheckCircle2 className="h-5 w-5 text-primary" />
                              ) : (
                                <AlertCircle className="h-5 w-5 text-destructive" />
                              )}
                            </div>
                          )}
                        </div>
                        <FormDescription className="flex items-start gap-2">
                          <Info className="h-4 w-4 mt-0.5 shrink-0" />
                          <span>
                            Users signing up with emails from this domain (e.g., user@{field.value || "example.org"}) will automatically become members of this organization. Each domain can only be linked to one organization.
                          </span>
                        </FormDescription>
                        {domainAvailable === false && (
                          <p className="text-sm text-destructive">This domain is already linked to another organization</p>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>
            </CardContent>
            <CardFooter>
              <Button
                type="submit"
                disabled={
                  isCreating ||
                  !usernameAvailable ||
                  !form.formState.isValid ||
                  Object.keys(form.formState.errors).length > 0 ||
                  (enableAutoJoin && !!form.watch("autoJoinDomain") && domainAvailable === false)
                }
                className="ml-auto"
              >
                {isCreating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create Organization"
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
