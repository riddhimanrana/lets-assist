"use client";

import { Project } from "@/types";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { toast } from "sonner";
import { updateProject } from "../actions";

// Constants for character limits
const TITLE_LIMIT = 75;
const LOCATION_LIMIT = 200;
const DESCRIPTION_LIMIT = 1000;

interface Props {
  project: Project;
}

// Define the form schema based on Project type
const formSchema = z.object({
  title: z.string()
    .min(1, "Title is required")
    .max(TITLE_LIMIT, `Title must be less than ${TITLE_LIMIT} characters`),
  description: z.string()
    .min(1, "Description is required")
    .max(DESCRIPTION_LIMIT, `Description must be less than ${DESCRIPTION_LIMIT} characters`),
  location: z.string()
    .min(1, "Location is required")
    .max(LOCATION_LIMIT, `Location must be less than ${LOCATION_LIMIT} characters`),
  require_login: z.boolean(),
  verification_method: z.enum(["qr-code", "manual", "auto"]),
});

type FormValues = z.infer<typeof formSchema>;

export default function EditProjectClient({ project }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [titleChars, setTitleChars] = useState(project.title.length);
  const [locationChars, setLocationChars] = useState(project.location.length);
  const [hasChanges, setHasChanges] = useState(false);

  const getCounterColor = (current: number, max: number) => {
    const percentage = (current / max) * 100;
    if (percentage >= 90) return "text-destructive";
    if (percentage >= 75) return "text-amber-500 dark:text-amber-400";
    return "text-muted-foreground";
  };

  // Helper function to check if HTML content is empty
  const isHTMLEmpty = (html: string) => {
    // Remove HTML tags and trim whitespace
    const text = html.replace(/<[^>]*>/g, '').trim();
    return !text;
  };

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: project.title,
      description: project.description,
      location: project.location,
      require_login: project.require_login,
      verification_method: project.verification_method,
    },
  });

  // Track form changes
  useEffect(() => {
    const subscription = form.watch((value, { name, type }) => {
      const formValues = form.getValues();
      const isChanged = 
        formValues.title !== project.title ||
        formValues.description !== project.description ||
        formValues.location !== project.location ||
        formValues.require_login !== project.require_login ||
        formValues.verification_method !== project.verification_method;
      
      setHasChanges(isChanged);
    });
    return () => subscription.unsubscribe();
  }, [form, project]);

  const onSubmit = async (values: FormValues) => {
    setSaving(true);
    try {
      const result = await updateProject(project.id, values);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Project updated successfully");
        router.push(`/projects/${project.id}`);
        router.refresh();
      }
    } catch (error) {
      toast.error("Failed to update project");
    } finally {
      setSaving(false);
    }
  };

  // Check if form is valid and has all required fields
  const isFormValid = form.formState.isValid && 
    form.getValues().title?.trim() && 
    form.getValues().location?.trim() && 
    !isHTMLEmpty(form.getValues().description || '');

  return (
    <div className="container mx-auto px-4 py-6 max-w-3xl">
      <div className="mb-6">
        <Button
          variant="ghost"
          className="gap-2"
          onClick={() => router.back()}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Project
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Edit Project</CardTitle>
          <CardDescription>
            Update the details of your project
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between">
                      <FormLabel>Project Title</FormLabel>
                      <span className={cn(
                        "text-xs transition-colors",
                        getCounterColor(titleChars, TITLE_LIMIT)
                      )}>
                        {titleChars}/{TITLE_LIMIT}
                      </span>
                    </div>
                    <FormControl>
                      <Input 
                        placeholder="Enter project title" 
                        {...field} 
                        onChange={e => {
                          field.onChange(e);
                          setTitleChars(e.target.value.length);
                        }}
                        maxLength={TITLE_LIMIT}
                      />
                    </FormControl>
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
                      <RichTextEditor
                        content={field.value}
                        onChange={field.onChange}
                        placeholder="Enter project description..."
                        maxLength={DESCRIPTION_LIMIT}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="location"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between">
                      <FormLabel>Location</FormLabel>
                      <span className={cn(
                        "text-xs transition-colors",
                        getCounterColor(locationChars, LOCATION_LIMIT)
                      )}>
                        {locationChars}/{LOCATION_LIMIT}
                      </span>
                    </div>
                    <FormControl>
                      <Input 
                        placeholder="Enter project location" 
                        {...field} 
                        onChange={e => {
                          field.onChange(e);
                          setLocationChars(e.target.value.length);
                        }}
                        maxLength={LOCATION_LIMIT}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="require_login"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel>Require Account</FormLabel>
                      <CardDescription>
                        Require volunteers to create an account to sign up
                      </CardDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="verification_method"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Verification Method</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select verification method" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="qr-code">QR Code Check-in</SelectItem>
                        <SelectItem value="manual">Manual Check-in</SelectItem>
                        <SelectItem value="auto">Automatic Check-in</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.back()}
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={saving || !hasChanges || !isFormValid}
                >
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Changes
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}