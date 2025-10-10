"use client";

import { Project, LocationData } from "@/types";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { cn, stripHtml } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
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
import {
  AlertTriangle,
  ArrowLeft,
  Loader2,
  Trash2,
  XCircle
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { toast } from "sonner";
import { updateProject, deleteProject, updateProjectStatus } from "../actions";
import LocationAutocomplete from "@/components/ui/location-autocomplete";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CancelProjectDialog } from "@/components/CancelProjectDialog";
import { canCancelProject, canDeleteProject } from "@/utils/project";
import { getProjectStartDateTime, getProjectEndDateTime } from "@/utils/project";
import { differenceInHours } from "date-fns";
import { createClient } from "@/utils/supabase/client";
import { NotificationService } from "@/services/notifications";
import Link from "next/link";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { updateCalendarEventForProject, removeCalendarEventForProject, removeAllVolunteerCalendarEvents } from "@/utils/calendar-helpers";

// Constants for character limits
const TITLE_LIMIT = 125;
const LOCATION_LIMIT = 200;
const DESCRIPTION_LIMIT = 2000;

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
  location_data: z.object({
    text: z.string(),
    display_name: z.string().optional(),
    coordinates: z.object({
      latitude: z.number(),
      longitude: z.number()
    }).optional()
  }).optional(),
  require_login: z.boolean(),
  verification_method: z.enum(["qr-code", "manual", "auto", "signup-only"]),
});

type FormValues = z.infer<typeof formSchema>;

export default function EditProjectClient({ project }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [titleChars, setTitleChars] = useState(project.title.length);
  const [locationChars, setLocationChars] = useState(project.location.length);
  const [hasChanges, setHasChanges] = useState(false);
  
  // Add state for cancel/delete dialogs
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);

  const getCounterColor = (current: number, max: number) => {
    const percentage = (current / max) * 100;
    if (percentage >= 90) return "text-destructive";
    if (percentage >= 75) return "text-chart-6";
    return "text-muted-foreground";
  };

  // Helper function to check if HTML content is empty
  const isHTMLEmpty = (html: string) => {
    // Remove HTML tags and trim whitespace using safe stripHtml function
    const text = stripHtml(html);
    return !text;
  };

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: project.title,
      description: project.description,
      location: project.location,
      location_data: project.location_data || {
        text: project.location,
        display_name: project.location
      },
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
        JSON.stringify(formValues.location_data) !== JSON.stringify(project.location_data) ||
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
        
        // Update calendar event if details changed (non-blocking)
        try {
          await updateCalendarEventForProject(project.id);
        } catch (calendarError) {
          console.error("Error updating calendar event:", calendarError);
          // Don't show error to user - this is non-critical
        }
        
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

  // Add handlers for cancel and delete project
  const handleCancelProject = async (reason: string) => {
    try {
      const result = await updateProjectStatus(project.id, "cancelled", reason);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Project cancelled successfully");
        
        // Remove calendar events (non-blocking)
        try {
          // Remove creator's calendar event
          await removeCalendarEventForProject(project.id);
          // Remove all volunteer calendar events
          await removeAllVolunteerCalendarEvents(project.id);
        } catch (calendarError) {
          console.error("Error removing calendar events:", calendarError);
          // Don't show error to user - this is non-critical
        }
        
        // Send cancellation notifications to all participants
        try {
          const supabase = createClient();
          const { data: signups, error } = await supabase
            .from('project_signups')
            .select('user_id')
            .eq('project_id', project.id);
            if (!error && signups) {
            for (const signup of signups) {
              if (signup.user_id) {
              await NotificationService.createNotification({
                title: `Project Cancelled`,
                body: `The project "${project.title}" which you signed up for has been cancelled.`,
                type: 'project_updates',
                actionUrl: `/projects/${project.id}`,
                data: { projectId: project.id, signupId: signup.user_id },
                severity: 'warning',
              }, signup.user_id);
              }
            }
            }
        } catch (notifyError) {
          console.error('Error sending cancellation notifications:', notifyError);
        }
        setShowCancelDialog(false);
        router.push(`/projects/${project.id}`);
        router.refresh();
      }
    } catch (error) {
      toast.error("Failed to cancel project");
    }
  };

  const handleDeleteProject = async () => {
    if (!canDeleteProject(project)) {
      toast.error("Projects cannot be deleted 24 hours before start until 48 hours after end");
      setShowDeleteDialog(false);
      return;
    }

    setIsDeleting(true);
    try {
      const result = await deleteProject(project.id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Project deleted successfully");
        router.push("/home");
      }
    } catch (error) {
      toast.error("Failed to delete project");
    } finally {
      setIsDeleting(false);
      setShowDeleteDialog(false);
    }
  };

  // Calculate time values for deletion restrictions
  const now = new Date();
  const startDateTime = getProjectStartDateTime(project);
  const endDateTime = getProjectEndDateTime(project);
  const hoursUntilStart = differenceInHours(startDateTime, now);
  const hoursAfterEnd = differenceInHours(now, endDateTime);
  
  const isInDeletionRestrictionPeriod = hoursUntilStart <= 24 && hoursAfterEnd <= 48;
  const canDelete = canDeleteProject(project);
  const canCancel = canCancelProject(project);
  const isCancelled = project.status === "cancelled";

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
                      <LocationAutocomplete
                        id="location"
                        value={form.getValues().location_data}
                        onChangeAction={(location_data) => {
                          if (location_data) {
                            // Update both the location field and location_data
                            field.onChange(location_data.text);
                            form.setValue("location_data", location_data);
                            setLocationChars(location_data.text.length);
                          } else {
                            field.onChange("");
                            form.setValue("location_data", undefined);
                            setLocationChars(0);
                          }
                        }}
                        maxLength={LOCATION_LIMIT}
                        required
                        error={!!form.formState.errors.location}
                        errorMessage={form.formState.errors.location?.message?.toString()}
                        aria-invalid={!!form.formState.errors.location}
                        aria-errormessage={form.formState.errors.location ? "location-error" : undefined}
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
                      <SelectItem value="qr-code">
                        <div className="flex flex-col group">
                        <span>QR Code Check-in</span>
                        <span className="text-xs text-muted-foreground hidden group-hover:block group-focus:block">
                          Volunteers scan a QR code at the event to check in
                        </span>
                        </div>
                      </SelectItem>
                      <SelectItem value="manual">
                        <div className="flex flex-col group">
                        <span>Manual Check-in</span>
                        <span className="text-xs text-muted-foreground hidden group-hover:block group-focus:block">
                          Project coordinators manually check in volunteers from the attendance page
                        </span>
                        </div>
                      </SelectItem>
                      <SelectItem value="auto">
                        <div className="flex flex-col group">
                        <span>Automatic Check-in</span>
                        <span className="text-xs text-muted-foreground hidden group-hover:block group-focus:block">
                          System automatically checks in volunteers at their scheduled time
                        </span>
                        </div>
                      </SelectItem>
                      <SelectItem value="signup-only">
                        <div className="flex flex-col group">
                        <span>Sign-up Only</span>
                        <span className="text-xs text-muted-foreground hidden group-hover:block group-focus:block">
                          No check-in process, only tracks who signed up
                        </span>
                        </div>
                      </SelectItem>
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

        {/* Add Danger Zone section */}
        <CardFooter className="flex flex-col border-t pt-6">
          <div className="w-full">
            <h3 className="text-lg font-medium text-destructive mb-2">Danger Zone</h3>
            <p className="text-sm text-muted-foreground mb-6">
              These actions can&apos;t be undone. Please proceed with caution.
            </p>
            
            {/* Project status notification */}
            {isCancelled && (
              <div className="mb-6 flex items-start gap-3 p-4 rounded-md border border-destructive bg-destructive/10">
                <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
                <div className="text-sm text-muted-foreground">
                  <p className="font-medium text-foreground mb-1">This project has been cancelled</p>
                  <p>
                    You can still edit details, but new signups are disabled and the project is marked as cancelled.
                    If this was a mistake, please contact <Link className="text-chart-3 hover:underline" href="mailto:support@lets-assist.com">support@lets-assist.com</Link>
                  </p>
                  {project.cancellation_reason && (
                    <p className="mt-2 font-medium">
                      Reason: <span className="font-normal">{project.cancellation_reason}</span>
                    </p>
                  )}
                </div>
              </div>
            )}
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Cancel Project Button */}
              {!isCancelled && (
                <div className="p-4 border rounded-lg bg-muted/30">
                  <h4 className="font-medium mb-2 flex items-center">
                    <XCircle className="h-4 w-4 mr-2 text-chart-4" />
                    Cancel Project
                  </h4>
                  <p className="text-sm text-muted-foreground mb-4">
                    Cancels the project and notifies all signed-up volunteers. The project remains in the system but is marked as cancelled.
                  </p>
                  <Button 
                    onClick={() => setShowCancelDialog(true)}
                    className="w-full bg-chart-4 hover:bg-chart-4/90"
                  >
                    Cancel Project
                  </Button>
                </div>
              )}

              {/* Delete Project Button */}
              <div className="p-4 border rounded-lg bg-muted/30">
                <h4 className="font-medium mb-2 flex items-center">
                  <Trash2 className="h-4 w-4 mr-2 text-destructive" />
                  Delete Project
                </h4>
                <p className="text-sm text-muted-foreground mb-4">
                  Permanently removes this project and all associated data. This action cannot be undone.
                </p>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div>
                        <Button 
                          variant="destructive"
                          onClick={() => setShowDeleteDialog(true)}
                          
                          className="w-full"
                        >
                          {isDeleting ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          ) : null}
                          Delete Project
                        </Button>
                      </div>
                    </TooltipTrigger>
                    {isInDeletionRestrictionPeriod && (
                      <TooltipContent className="max-w-[250px] text-center p-2">
                        <p>Projects cannot be deleted during the 72-hour window around the event</p>
                      </TooltipContent>
                    )}
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>
          </div>
        </CardFooter>
      </Card>

      {/* Delete Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent className="max-w-[95vw] sm:max-w-[425px]">
          <AlertDialogHeader className="space-y-3">
            <AlertDialogTitle className="text-lg sm:text-xl">Are you sure?</AlertDialogTitle>
            <AlertDialogDescription className="text-sm">
              This action cannot be undone. This will permanently delete your
              project and remove all data associated with it, including volunteer
              signups and documents. If you need to cancel or reschedule, we recommend you cancel the project instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2 sm:gap-3">
            <AlertDialogCancel className="w-full sm:w-auto mt-0">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteProject}
              className="w-full sm:w-auto bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete Project"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel Project Dialog */}
      <CancelProjectDialog
        project={project}
        isOpen={showCancelDialog}
        onClose={() => setShowCancelDialog(false)}
        onConfirm={handleCancelProject}
      />
    </div>
  );
}