"use client";

import { Project, ProjectSchedule } from "@/types";
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
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertTriangle,
  ArrowLeft,
  Loader2,
  Trash2,
  XCircle,
  Calendar as CalendarIconLucide,
  ChevronDown,
  ChevronRight,
  Upload,
  FileText,
  File,
  FileImage,
  Eye,
  ImageIcon,
  X
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
import { canDeleteProject } from "@/utils/project";
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
import Schedule from "@/app/projects/create/Schedule";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import Image from "next/image";
import { formatBytes } from "@/lib/utils";
import FilePreview from "@/components/FilePreview";

// Constants for character limits
const TITLE_LIMIT = 125;
const LOCATION_LIMIT = 200;
const DESCRIPTION_LIMIT = 2000;

// Constants for file validations
const MAX_COVER_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_DOCUMENTS_COUNT = 5;

// Allowed file types
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/jpg"];
const ALLOWED_DOCUMENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/jpg',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
];

// File type icon mapping
const getFileIcon = (type: string) => {
  if (type.includes('pdf')) return <FileText className="h-5 w-5" />;
  if (type.includes('image')) return <FileImage className="h-5 w-5" />;
  if (type.includes('text')) return <FileText className="h-5 w-5" />;
  if (type.includes('word')) return <FileText className="h-5 w-5" />;
  return <File className="h-5 w-5" />;
};

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

// Helper to initialize schedule state from project
function initializeScheduleState(project: Project) {
  const eventType = project.event_type;
  
  if (eventType === "oneTime" && project.schedule.oneTime) {
    return {
      oneTime: {
        date: project.schedule.oneTime.date,
        startTime: project.schedule.oneTime.startTime,
        endTime: project.schedule.oneTime.endTime,
        volunteers: project.schedule.oneTime.volunteers,
      },
      multiDay: [{ date: "", slots: [{ startTime: "", endTime: "", volunteers: 0 }] }],
      sameDayMultiArea: {
        date: "",
        overallStart: "",
        overallEnd: "",
        roles: [{ name: "", startTime: "", endTime: "", volunteers: 0 }],
      },
    };
  } else if (eventType === "multiDay" && project.schedule.multiDay) {
    return {
      oneTime: { date: "", startTime: "", endTime: "", volunteers: 0 },
      multiDay: project.schedule.multiDay.map(day => ({
        date: day.date,
        slots: day.slots.map(slot => ({
          startTime: slot.startTime,
          endTime: slot.endTime,
          volunteers: slot.volunteers,
        })),
      })),
      sameDayMultiArea: {
        date: "",
        overallStart: "",
        overallEnd: "",
        roles: [{ name: "", startTime: "", endTime: "", volunteers: 0 }],
      },
    };
  } else if (eventType === "sameDayMultiArea" && project.schedule.sameDayMultiArea) {
    return {
      oneTime: { date: "", startTime: "", endTime: "", volunteers: 0 },
      multiDay: [{ date: "", slots: [{ startTime: "", endTime: "", volunteers: 0 }] }],
      sameDayMultiArea: {
        date: project.schedule.sameDayMultiArea.date,
        overallStart: project.schedule.sameDayMultiArea.overallStart,
        overallEnd: project.schedule.sameDayMultiArea.overallEnd,
        roles: project.schedule.sameDayMultiArea.roles.map(role => ({
          name: role.name,
          startTime: role.startTime,
          endTime: role.endTime,
          volunteers: role.volunteers,
        })),
      },
    };
  }
  
  return {
    oneTime: { date: "", startTime: "", endTime: "", volunteers: 0 },
    multiDay: [{ date: "", slots: [{ startTime: "", endTime: "", volunteers: 0 }] }],
    sameDayMultiArea: {
      date: "",
      overallStart: "",
      overallEnd: "",
      roles: [{ name: "", startTime: "", endTime: "", volunteers: 0 }],
    },
  };
}

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
  
  // Schedule editing state
  const [scheduleState, setScheduleState] = useState(() => initializeScheduleState(project));
  const [scheduleErrors, setScheduleErrors] = useState<z.ZodIssue[]>([]);
  const [isScheduleOpen, setIsScheduleOpen] = useState(false);
  
  // Media & Documents state
  const [isMediaOpen, setIsMediaOpen] = useState(false);
  const [uploadingCoverImage, setUploadingCoverImage] = useState(false);
  const [uploadingDocuments, setUploadingDocuments] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewDocName, setPreviewDocName] = useState<string>("Document");
  const [previewDocType, setPreviewDocType] = useState<string>("");
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [totalDocumentsSize, setTotalDocumentsSize] = useState<number>(0);

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

  // Schedule update handlers
  const updateOneTimeSchedule = (field: keyof typeof scheduleState.oneTime, value: string | number) => {
    setScheduleState(prev => ({
      ...prev,
      oneTime: { ...prev.oneTime, [field]: value }
    }));
  };

  const updateMultiDaySchedule = (dayIndex: number, field: string, value: string | number, slotIndex?: number) => {
    setScheduleState(prev => {
      const newMultiDay = [...prev.multiDay];
      if (slotIndex !== undefined) {
        newMultiDay[dayIndex].slots[slotIndex] = {
          ...newMultiDay[dayIndex].slots[slotIndex],
          [field]: value
        };
      } else {
        newMultiDay[dayIndex] = { ...newMultiDay[dayIndex], [field]: value };
      }
      return { ...prev, multiDay: newMultiDay };
    });
  };

  const updateMultiRoleSchedule = (field: string, value: string | number, roleIndex?: number) => {
    setScheduleState(prev => {
      if (roleIndex !== undefined) {
        const newRoles = [...prev.sameDayMultiArea.roles];
        newRoles[roleIndex] = { ...newRoles[roleIndex], [field]: value };
        return {
          ...prev,
          sameDayMultiArea: { ...prev.sameDayMultiArea, roles: newRoles }
        };
      } else {
        return {
          ...prev,
          sameDayMultiArea: { ...prev.sameDayMultiArea, [field]: value }
        };
      }
    });
  };

  const addMultiDaySlot = (dayIndex: number) => {
    setScheduleState(prev => {
      const newMultiDay = [...prev.multiDay];
      newMultiDay[dayIndex].slots.push({ startTime: "", endTime: "", volunteers: 0 });
      return { ...prev, multiDay: newMultiDay };
    });
  };

  const addMultiDayEvent = () => {
    setScheduleState(prev => ({
      ...prev,
      multiDay: [...prev.multiDay, { date: "", slots: [{ startTime: "", endTime: "", volunteers: 0 }] }]
    }));
  };

  const addRole = () => {
    setScheduleState(prev => ({
      ...prev,
      sameDayMultiArea: {
        ...prev.sameDayMultiArea,
        roles: [...prev.sameDayMultiArea.roles, { name: "", startTime: "", endTime: "", volunteers: 0 }]
      }
    }));
  };

  const removeDay = (dayIndex: number) => {
    setScheduleState(prev => ({
      ...prev,
      multiDay: prev.multiDay.filter((_, i) => i !== dayIndex)
    }));
  };

  const removeSlot = (dayIndex: number, slotIndex: number) => {
    setScheduleState(prev => {
      const newMultiDay = [...prev.multiDay];
      newMultiDay[dayIndex].slots = newMultiDay[dayIndex].slots.filter((_, i) => i !== slotIndex);
      return { ...prev, multiDay: newMultiDay };
    });
  };

  const removeRole = (roleIndex: number) => {
    setScheduleState(prev => ({
      ...prev,
      sameDayMultiArea: {
        ...prev.sameDayMultiArea,
        roles: prev.sameDayMultiArea.roles.filter((_, i) => i !== roleIndex)
      }
    }));
  };

  // Track form changes (including schedule)
  useEffect(() => {
    const subscription = form.watch((_value, { name: _name, type: _type }) => {
      const formValues = form.getValues();
      const basicInfoChanged = 
        formValues.title !== project.title ||
        formValues.description !== project.description ||
        formValues.location !== project.location ||
        JSON.stringify(formValues.location_data) !== JSON.stringify(project.location_data) ||
        formValues.require_login !== project.require_login ||
        formValues.verification_method !== project.verification_method;
      
      const initialSchedule = initializeScheduleState(project);
      const scheduleChanged = JSON.stringify(scheduleState) !== JSON.stringify(initialSchedule);
      
      setHasChanges(basicInfoChanged || scheduleChanged);
    });
    return () => subscription.unsubscribe();
  }, [form, project, scheduleState]);

  // Separate effect to track schedule changes independently
  useEffect(() => {
    const initialSchedule = initializeScheduleState(project);
    const scheduleChanged = JSON.stringify(scheduleState) !== JSON.stringify(initialSchedule);
    
    const formValues = form.getValues();
    const basicInfoChanged = 
      formValues.title !== project.title ||
      formValues.description !== project.description ||
      formValues.location !== project.location ||
      JSON.stringify(formValues.location_data) !== JSON.stringify(project.location_data) ||
      formValues.require_login !== project.require_login ||
      formValues.verification_method !== project.verification_method;
    
    setHasChanges(basicInfoChanged || scheduleChanged);
  }, [scheduleState, form, project]);

  // Calculate total documents size
  useEffect(() => {
    const totalSize = (project.documents || []).reduce((sum, doc) => sum + (doc.size || 0), 0);
    setTotalDocumentsSize(totalSize);
  }, [project.documents]);

  // Media & Documents handlers
  const validateImage = (file: File): boolean => {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      toast.error("Invalid image type. Please use JPEG, PNG, or WebP");
      return false;
    }
    if (file.size > MAX_COVER_IMAGE_SIZE) {
      toast.error(`Image too large. Maximum size is ${formatBytes(MAX_COVER_IMAGE_SIZE)}`);
      return false;
    }
    return true;
  };

  const validateDocument = (file: File): boolean => {
    if (!ALLOWED_DOCUMENT_TYPES.includes(file.type)) {
      toast.error("Invalid file type");
      return false;
    }
    const currentTotalSize = (project.documents || []).reduce((sum, doc) => sum + (doc.size || 0), 0);
    if (currentTotalSize + file.size > MAX_DOCUMENT_SIZE) {
      toast.error("Total document size limit exceeded");
      return false;
    }
    if ((project.documents || []).length >= MAX_DOCUMENTS_COUNT) {
      toast.error("Maximum number of documents reached");
      return false;
    }
    return true;
  };

  const handleCoverImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (!validateImage(file)) return;

      setUploadingCoverImage(true);
      const loadingToast = toast.loading("Uploading cover image...");
      
      try {
        const supabase = createClient();
        const fileExt = file.name.split('.').pop();
        const timestamp = Date.now();
        const fileName = `project_${project.id}_cover_${timestamp}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from('project-images')
          .upload(fileName, file);

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage
          .from('project-images')
          .getPublicUrl(fileName);

        const result = await updateProject(project.id, {
          cover_image_url: urlData.publicUrl
        });

        if (result.error) throw new Error(result.error);

        toast.dismiss(loadingToast);
        toast.success("Cover image uploaded successfully");
        router.refresh();
      } catch (error) {
        console.error('Upload error:', error);
        toast.dismiss(loadingToast);
        toast.error("Failed to upload cover image");
      } finally {
        setUploadingCoverImage(false);
      }
    }
  };

  const removeCoverImage = async () => {
    if (!project.cover_image_url) return;

    try {
      const supabase = createClient();
      const urlParts = new URL(project.cover_image_url);
      const pathParts = urlParts.pathname.split("/");
      const fileName = pathParts[pathParts.length - 1];

      const { error: deleteError } = await supabase.storage
        .from('project-images')
        .remove([fileName]);

      if (deleteError) console.warn('Storage delete error:', deleteError);

      const result = await updateProject(project.id, {
        cover_image_url: null
      });

      if (result.error) throw new Error(result.error);

      toast.success("Cover image removed");
      router.refresh();
    } catch (error) {
      console.error('Delete error:', error);
      toast.error("Failed to remove cover image");
    }
  };

  const handleDocumentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;

    const files = Array.from(e.target.files);
    const totalFiles = (project.documents || []).length + files.length;
    
    if (totalFiles > MAX_DOCUMENTS_COUNT) {
      toast.error(`Maximum ${MAX_DOCUMENTS_COUNT} documents allowed`);
      return;
    }

    const currentTotalSize = (project.documents || []).reduce((sum, doc) => sum + (doc.size || 0), 0);
    const newFilesTotalSize = files.reduce((sum, file) => sum + file.size, 0);
    
    if (currentTotalSize + newFilesTotalSize > MAX_DOCUMENT_SIZE) {
      toast.error("Total document size limit exceeded");
      return;
    }

    setUploadingDocuments(true);
    const loadingToast = toast.loading(`Uploading ${files.length} document(s)...`);

    try {
      const supabase = createClient();
      const uploadedDocs = [];

      for (const file of files) {
        if (!validateDocument(file)) continue;

        const fileExt = file.name.split('.').pop();
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 8);
        const fileName = `project_${project.id}_doc_${timestamp}_${random}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from('project-documents')
          .upload(fileName, file);

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage
          .from('project-documents')
          .getPublicUrl(fileName);

        uploadedDocs.push({
          name: file.name,
          originalName: file.name,
          url: urlData.publicUrl,
          type: file.type,
          size: file.size,
        });
      }

      const updatedDocs = [...(project.documents || []), ...uploadedDocs];
      const result = await updateProject(project.id, {
        documents: updatedDocs,
      });

      if (result.error) throw new Error(result.error);

      toast.dismiss(loadingToast);
      toast.success(`${uploadedDocs.length} document(s) uploaded successfully`);
      router.refresh();
    } catch (error) {
      console.error('Upload error:', error);
      toast.dismiss(loadingToast);
      toast.error("Failed to upload documents");
    } finally {
      setUploadingDocuments(false);
    }
  };

  const handleDeleteDocument = async (docUrl: string) => {
    try {
      const supabase = createClient();
      const urlParts = new URL(docUrl);
      const pathParts = urlParts.pathname.split("/");
      const fileName = pathParts[pathParts.length - 1];

      const { error: storageError } = await supabase.storage
        .from('project-documents')
        .remove([fileName]);

      if (storageError) console.warn('Storage delete error:', storageError);

      const updatedDocs = (project.documents || []).filter(doc => doc.url !== docUrl);
      const result = await updateProject(project.id, {
        documents: updatedDocs,
      });

      if (result.error) throw new Error(result.error);

      toast.success("Document deleted");
      router.refresh();
    } catch (error) {
      console.error('Delete error:', error);
      toast.error("Failed to delete document");
    }
  };

  const openPreview = (url: string, fileName: string = "Document", fileType: string = "") => {
    setPreviewDoc(url);
    setPreviewDocName(fileName);
    setPreviewDocType(fileType);
    setPreviewOpen(true);
  };

  const isPreviewable = (type: string) => {
    return type.includes('pdf') || type.includes('image');
  };

  const onSubmit = async (values: FormValues) => {
    setSaving(true);
    setScheduleErrors([]);
    
    try {
      // Build schedule object based on event type
      let schedule: ProjectSchedule = {};
      const eventType = project.event_type;
      
      if (eventType === "oneTime") {
        schedule = { oneTime: scheduleState.oneTime };
      } else if (eventType === "multiDay") {
        schedule = { multiDay: scheduleState.multiDay };
      } else if (eventType === "sameDayMultiArea") {
        schedule = { sameDayMultiArea: scheduleState.sameDayMultiArea };
      }
      
      // Combine form values with schedule
      const updates = {
        ...values,
        schedule,
      };
      
      const result = await updateProject(project.id, updates);
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
    } catch {
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
    } catch {
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
        router.refresh(); // Trigger server-side re-fetch of home page data
      }
    } catch {
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

              <Separator className="my-6" />

              {/* Schedule Section - Collapsible */}
              <Collapsible open={isScheduleOpen} onOpenChange={setIsScheduleOpen}>
                <CollapsibleTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full justify-between p-4 hover:bg-muted/50 h-auto"
                  >
                    <div className="flex items-center gap-2">
                      <CalendarIconLucide className="h-5 w-5 text-muted-foreground" />
                      <h3 className="text-lg font-semibold">Schedule & Timing</h3>
                    </div>
                    {isScheduleOpen ? (
                      <ChevronDown className="h-5 w-5 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    )}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-4 pt-4">
                  <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Important</AlertTitle>
                    <AlertDescription>
                      Changing dates or times may affect volunteers who have already signed up. 
                      Consider notifying them of any changes. Reducing volunteer capacity below 
                      current signups is not recommended.
                    </AlertDescription>
                  </Alert>
                  <p className="text-sm text-muted-foreground">
                    Update the dates, times, and volunteer capacity for this project.
                  </p>
                  <Schedule
                    state={{
                      eventType: project.event_type,
                      schedule: scheduleState
                    }}
                    updateOneTimeScheduleAction={updateOneTimeSchedule}
                    updateMultiDayScheduleAction={updateMultiDaySchedule}
                    updateMultiRoleScheduleAction={updateMultiRoleSchedule}
                    addMultiDaySlotAction={addMultiDaySlot}
                    addMultiDayEventAction={addMultiDayEvent}
                    addRoleAction={addRole}
                    removeDayAction={removeDay}
                    removeSlotAction={removeSlot}
                    removeRoleAction={removeRole}
                    errors={scheduleErrors}
                  />
                </CollapsibleContent>
              </Collapsible>

              <Separator className="my-6" />

              {/* Media & Documents Section - Collapsible */}
              <Collapsible open={isMediaOpen} onOpenChange={setIsMediaOpen}>
                <CollapsibleTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full justify-between p-4 hover:bg-muted/50 h-auto"
                  >
                    <div className="flex items-center gap-2">
                      <ImageIcon className="h-5 w-5 text-muted-foreground" />
                      <h3 className="text-lg font-semibold">Media & Documents</h3>
                    </div>
                    {isMediaOpen ? (
                      <ChevronDown className="h-5 w-5 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    )}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-6 pt-4">
                  {/* Cover Image Upload */}
                  <div className="space-y-3">
                    <div>
                      <h4 className="font-medium text-sm">Cover Image</h4>
                      <p className="text-xs text-muted-foreground mt-1">
                        Upload a cover image for your project (JPEG, PNG, WebP, max {formatBytes(MAX_COVER_IMAGE_SIZE)})
                      </p>
                    </div>
                    
                    <div className="border-2 border-dashed rounded-lg p-4 transition-colors hover:border-primary/50 hover:bg-primary/5">
                      {project.cover_image_url ? (
                        <div className="w-full max-w-md mx-auto">
                          <AspectRatio ratio={16/9} className="bg-muted overflow-hidden rounded-md">
                            <div className="relative w-full h-full">
                              <Image
                                src={project.cover_image_url}
                                alt="Cover image"
                                fill
                                className="object-cover rounded-md"
                              />
                              <Button
                                type="button"
                                variant="destructive"
                                size="icon"
                                className="absolute top-2 right-2 h-8 w-8 shadow-lg"
                                onClick={removeCoverImage}
                                disabled={uploadingCoverImage}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          </AspectRatio>
                        </div>
                      ) : (
                        <label className="flex flex-col items-center justify-center py-6 cursor-pointer">
                          <div className="rounded-full bg-background p-3 shadow-sm mb-3">
                            <ImageIcon className="h-6 w-6 text-muted-foreground" />
                          </div>
                          <p className="text-sm font-medium mb-1">
                            {uploadingCoverImage ? "Uploading..." : "Click to upload cover image"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {uploadingCoverImage ? "Please wait..." : "or drag and drop"}
                          </p>
                          <input
                            type="file"
                            accept={ALLOWED_IMAGE_TYPES.join(",")}
                            className="hidden"
                            onChange={handleCoverImageChange}
                            disabled={uploadingCoverImage}
                          />
                        </label>
                      )}
                    </div>
                  </div>

                  {/* Supporting Documents */}
                  <div className="space-y-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-medium text-sm">Supporting Documents</h4>
                        <p className="text-xs text-muted-foreground mt-1">
                          Upload permission slips, waivers, instructions (PDF, Word, Text, Images)
                        </p>
                      </div>
                      <div className="text-xs text-muted-foreground text-right">
                        <div>{(project.documents || []).length}/{MAX_DOCUMENTS_COUNT} files</div>
                        <div>{formatBytes(totalDocumentsSize)}/{formatBytes(MAX_DOCUMENT_SIZE)}</div>
                      </div>
                    </div>

                    <div className={`border-2 border-dashed rounded-lg p-4 transition-colors ${
                      (project.documents || []).length >= MAX_DOCUMENTS_COUNT 
                        ? 'opacity-50 cursor-not-allowed' 
                        : 'hover:border-primary/50 hover:bg-primary/5'
                    }`}>
                      <label className={`flex flex-col items-center justify-center py-6 ${
                        (project.documents || []).length >= MAX_DOCUMENTS_COUNT ? 'cursor-not-allowed' : 'cursor-pointer'
                      }`}>
                        <div className="rounded-full bg-background p-3 shadow-sm mb-3">
                          <Upload className="h-6 w-6 text-muted-foreground" />
                        </div>
                        <p className="text-sm font-medium mb-1">
                          {(project.documents || []).length >= MAX_DOCUMENTS_COUNT 
                            ? "Maximum files reached" 
                            : uploadingDocuments ? "Uploading..." : "Click to upload documents"
                          }
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {(project.documents || []).length >= MAX_DOCUMENTS_COUNT 
                            ? `Limit of ${MAX_DOCUMENTS_COUNT} files reached`
                            : uploadingDocuments ? "Please wait..." : "or drag and drop (multiple files allowed)"
                          }
                        </p>
                        <input
                          type="file"
                          multiple
                          accept={ALLOWED_DOCUMENT_TYPES.join(",")}
                          className="hidden"
                          onChange={handleDocumentUpload}
                          disabled={uploadingDocuments || (project.documents || []).length >= MAX_DOCUMENTS_COUNT}
                        />
                      </label>
                    </div>

                    {/* Documents List */}
                    {project.documents && project.documents.length > 0 && (
                      <div className="space-y-2 mt-4">
                        {project.documents.map((doc, index) => (
                          <div
                            key={index}
                            className={cn(
                              "flex items-center justify-between p-3 rounded-md transition-colors",
                              hoverIndex === index ? "bg-muted" : "bg-muted/40"
                            )}
                            onMouseEnter={() => setHoverIndex(index)}
                            onMouseLeave={() => setHoverIndex(null)}
                          >
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              {getFileIcon(doc.type)}
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium truncate">{doc.name}</p>
                                <p className="text-xs text-muted-foreground">{formatBytes(doc.size)}</p>
                              </div>
                            </div>
                            <div className="flex gap-1 flex-shrink-0">
                              {isPreviewable(doc.type) && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => openPreview(doc.url, doc.name, doc.type)}
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                              )}
                              <Button
                                type="button"
                                variant={hoverIndex === index ? "destructive" : "ghost"}
                                size="icon"
                                className="h-8 w-8 transition-colors"
                                onClick={() => handleDeleteDocument(doc.url)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>

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

      {/* File Preview */}
      <FilePreview 
        url={previewDoc || ""}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        fileName={previewDocName}
        fileType={previewDocType}
      />
    </div>
  );
}