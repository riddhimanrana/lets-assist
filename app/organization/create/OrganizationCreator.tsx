"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2, Globe, Upload, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { createOrganization, checkOrgUsername } from "./actions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import ImageCropper from "@/components/ImageCropper";

// Constants
const USERNAME_MAX_LENGTH = 32;
const NAME_MAX_LENGTH = 64;
const WEBSITE_MAX_LENGTH = 100;
const DESCRIPTION_MAX_LENGTH = 500;
const USERNAME_REGEX = /^[a-zA-Z0-9_.-]+$/;

// Form schema
const orgCreationSchema = z.object({
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
  
  type: z.enum(["nonprofit", "school", "company"]),
  
  logoUrl: z.string().optional().nullable(),
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
                    Optional. Upload a square logo for your organization.
                  </p>
                </div>
              </div>

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Organization Name*</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Enter organization name" maxLength={NAME_MAX_LENGTH} />
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
                    <FormLabel>Username*</FormLabel>
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
                      Used in your organization&apos;s URL: letsassist.app/organization/<span className="font-mono">{field.value || "username"}</span>
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
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder="Describe your organization"
                        className="resize-none"
                        rows={4}
                        maxLength={DESCRIPTION_MAX_LENGTH}
                      />
                    </FormControl>
                    <FormDescription className="flex justify-between">
                      <span>A brief description of your organization</span>
                      <span className="text-muted-foreground">
                        {field.value?.length || 0}/{DESCRIPTION_MAX_LENGTH}
                      </span>
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
                        />
                      </FormControl>
                    </div>
                    <FormDescription>
                      Optional. Include your organization&apos;s website
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem className="space-y-3">
                    <FormLabel>Organization Type*</FormLabel>
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                        className="flex flex-col space-y-1"
                      >
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl>
                            <RadioGroupItem value="nonprofit" />
                          </FormControl>
                          <FormLabel className="font-normal">Nonprofit</FormLabel>
                        </FormItem>
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl>
                            <RadioGroupItem value="school" />
                          </FormControl>
                          <FormLabel className="font-normal">School</FormLabel>
                        </FormItem>
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl>
                            <RadioGroupItem value="company" />
                          </FormControl>
                          <FormLabel className="font-normal">Company</FormLabel>
                        </FormItem>
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
            <CardFooter>
              <Button 
                type="submit" 
                disabled={isCreating || !usernameAvailable}
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
