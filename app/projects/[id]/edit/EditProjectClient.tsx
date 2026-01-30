"use client";

import { Project, ProjectSchedule, RecurrenceFrequency, RecurrenceEndType, RecurrenceWeekday } from "@/types";
import { useRouter } from "next/navigation";
import { useState, useEffect, useRef } from "react";
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
  Field,
  FieldLabel,
  FieldDescription,
  FieldError as FormMessage,
} from "@/components/ui/field";
import { Controller } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button, buttonVariants } from "@/components/ui/button";
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
  Download,
  Eye,
  ImageIcon,
  X
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { toast } from "sonner";
import { updateProject, deleteProject, updateProjectStatus, uploadProjectWaiverPdf, removeProjectWaiverPdf } from "../actions";
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
import { CancelProjectDialog } from "@/app/projects/_components/CancelProjectDialog";
import { canDeleteProject } from "@/utils/project";
import { getProjectStartDateTime, getProjectEndDateTime } from "@/utils/project";
import { differenceInHours } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { updateCalendarEventForProject } from "@/utils/calendar-helpers";
import Schedule from "@/app/projects/create/Schedule";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import Image from "next/image";
import { formatBytes } from "@/lib/utils";
import FilePreview from "@/app/projects/_components/FilePreview";

// Constants for character limits
const TITLE_LIMIT = 125;
const LOCATION_LIMIT = 200;
const DESCRIPTION_LIMIT = 2000;

// Constants for file validations
const MAX_COVER_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_DOCUMENTS_COUNT = 5;
const MAX_WAIVER_PDF_SIZE = 10 * 1024 * 1024; // 10MB

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
  enable_volunteer_comments: z.boolean(),
  show_attendees_publicly: z.boolean(),
  waiver_required: z.boolean(),
  waiver_allow_upload: z.boolean(),
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

// Helper to initialize recurrence state from project
function initializeRecurrenceState(project: Project) {
  const recurrence = project.recurrence_rule;

  return {
    enabled: !!recurrence,
    frequency: (recurrence?.frequency || "weekly") as RecurrenceFrequency,
    interval: recurrence?.interval || 1,
    endType: (recurrence?.end_type || "never") as RecurrenceEndType,
    endDate: recurrence?.end_date || undefined,
    endOccurrences: recurrence?.end_occurrences || undefined,
    weekdays: (recurrence?.weekdays || []) as RecurrenceWeekday[],
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
  const [recurrenceState, setRecurrenceState] = useState(() => initializeRecurrenceState(project));
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_dragActive, _setDragActive] = useState<"cover" | "docs" | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [totalDocumentsSize, setTotalDocumentsSize] = useState<number>(0);
  const [waiverPdfUploading, setWaiverPdfUploading] = useState(false);
  const [waiverPdfError, setWaiverPdfError] = useState<string | null>(null);
  const [waiverPdfValidation, setWaiverPdfValidation] = useState<{ hasSignatureFields: boolean; warnings: string[] } | null>(null);
  const waiverPdfInputRef = useRef<HTMLInputElement | null>(null);

  const getCounterColor = (current: number, max: number) => {
    const percentage = (current / max) * 100;
    if (percentage >= 90) return "text-destructive";
    if (percentage >= 75) return "text-warning";
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
      enable_volunteer_comments: project.enable_volunteer_comments ?? false,
      show_attendees_publicly: project.show_attendees_publicly ?? false,
      waiver_required: project.waiver_required ?? false,
      waiver_allow_upload: project.waiver_allow_upload ?? true,
      verification_method: project.verification_method,
    },
  });

  const waiverRequired = form.watch("waiver_required");

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

  const updateRecurrence = (
    field: keyof typeof recurrenceState,
    value: typeof recurrenceState[keyof typeof recurrenceState]
  ) => {
    setRecurrenceState(prev => ({
      ...prev,
      [field]: value
    }));
  };

  // Track form changes (including schedule)
  useEffect(() => {
    const subscription = form.watch(() => {
      const formValues = form.getValues();
      const basicInfoChanged =
        formValues.title !== project.title ||
        formValues.description !== project.description ||
        formValues.location !== project.location ||
        JSON.stringify(formValues.location_data) !== JSON.stringify(project.location_data) ||
        formValues.require_login !== project.require_login ||
        formValues.enable_volunteer_comments !== (project.enable_volunteer_comments ?? false) ||
        formValues.show_attendees_publicly !== (project.show_attendees_publicly ?? false) ||
        formValues.waiver_required !== (project.waiver_required ?? false) ||
        formValues.waiver_allow_upload !== (project.waiver_allow_upload ?? true) ||
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
      formValues.enable_volunteer_comments !== (project.enable_volunteer_comments ?? false) ||
      formValues.show_attendees_publicly !== (project.show_attendees_publicly ?? false) ||
      formValues.waiver_required !== (project.waiver_required ?? false) ||
      formValues.waiver_allow_upload !== (project.waiver_allow_upload ?? true) ||
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

  const validateWaiverPdf = async (file: File) => {
    setWaiverPdfError(null);

    if (file.type !== "application/pdf") {
      setWaiverPdfError("Please upload a PDF file.");
      return null;
    }

    if (file.size > MAX_WAIVER_PDF_SIZE) {
      setWaiverPdfError(`File size must be less than ${formatBytes(MAX_WAIVER_PDF_SIZE)}.`);
      return null;
    }

    try {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const header = String.fromCharCode(...bytes.slice(0, 5));

      if (header !== "%PDF-") {
        setWaiverPdfError("Invalid PDF file.");
        return null;
      }

      const pdfText = new TextDecoder("latin1").decode(bytes);
      const hasSignatureFields =
        pdfText.includes("/Sig") ||
        pdfText.includes("/AcroForm") ||
        pdfText.includes("/SigFlags") ||
        pdfText.includes("signature") ||
        pdfText.includes("/Widget");

      const warnings: string[] = [];
      if (!hasSignatureFields) {
        warnings.push("No signature fields detected. Volunteers will sign electronically alongside the PDF.");
      }

      const validation = { hasSignatureFields, warnings };
      setWaiverPdfValidation(validation);
      return validation;
    } catch (error) {
      console.error("Error validating waiver PDF:", error);
      setWaiverPdfError("Error reading PDF file. Please try again.");
      return null;
    }
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

  const handleWaiverPdfUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const validation = await validateWaiverPdf(file);
    if (!validation) return;

    setWaiverPdfUploading(true);
    const loadingToast = toast.loading("Uploading waiver PDF...");

    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsDataURL(file);
      });

      const result = await uploadProjectWaiverPdf(project.id, dataUrl, file.name);
      if (result.error) {
        throw new Error(result.error);
      }

      toast.dismiss(loadingToast);
      toast.success("Waiver PDF uploaded successfully");
      router.refresh();
    } catch (error) {
      console.error("Upload waiver PDF error:", error);
      toast.dismiss(loadingToast);
      toast.error("Failed to upload waiver PDF");
    } finally {
      setWaiverPdfUploading(false);
      if (waiverPdfInputRef.current) {
        waiverPdfInputRef.current.value = "";
      }
    }
  };

  const handleRemoveWaiverPdf = async () => {
    setWaiverPdfUploading(true);
    const loadingToast = toast.loading("Removing waiver PDF...");

    try {
      const result = await removeProjectWaiverPdf(project.id);
      if (result.error) {
        throw new Error(result.error);
      }

      toast.dismiss(loadingToast);
      toast.success("Waiver PDF removed");
      setWaiverPdfValidation(null);
      router.refresh();
    } catch (error) {
      console.error("Remove waiver PDF error:", error);
      toast.dismiss(loadingToast);
      toast.error("Failed to remove waiver PDF");
    } finally {
      setWaiverPdfUploading(false);
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

      // Build recurrence rule if enabled
      const recurrenceRule = recurrenceState.enabled ? {
        frequency: recurrenceState.frequency,
        interval: recurrenceState.interval || 1,
        end_type: recurrenceState.endType,
        end_date: recurrenceState.endDate || undefined,
        end_occurrences: recurrenceState.endOccurrences || undefined,
        weekdays: recurrenceState.weekdays || [],
      } : null;
      const normalizedRecurrenceRule = recurrenceRule ?? undefined;

      // Combine form values with schedule
      const updates: Partial<Project> = {
        ...values,
        schedule,
        recurrence_rule: normalizedRecurrenceRule,
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
        const notificationStatus = result.cancellationNotifications;
        if (notificationStatus?.enqueued) {
          toast.success("Project cancelled successfully. Approved volunteers will be emailed shortly.");
          if (notificationStatus.error) {
            toast.warning(notificationStatus.error);
          }
        } else {
          toast.success("Project cancelled successfully.");
          toast.warning(
            notificationStatus?.error ||
            "We couldn't queue cancellation emails. Please try again shortly."
          );
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

          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <Controller
              control={form.control}
              name="title"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <div className="flex items-center justify-between">
                    <FieldLabel htmlFor={field.name}>Project Title</FieldLabel>
                    <span className={cn(
                      "text-xs transition-colors",
                      getCounterColor(titleChars, TITLE_LIMIT)
                    )}>
                      {titleChars}/{TITLE_LIMIT}
                    </span>
                  </div>
                  <Input
                    id={field.name}
                    placeholder="Enter project title"
                    {...field}
                    onChange={e => {
                      field.onChange(e);
                      setTitleChars(e.target.value.length);
                    }}
                    maxLength={TITLE_LIMIT}
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.invalid && <FormMessage errors={[fieldState.error]} />}
                </Field>
              )}
            />

            <Controller
              control={form.control}
              name="description"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>Description</FieldLabel>
                  <RichTextEditor
                    content={field.value}
                    onChange={field.onChange}
                    placeholder="Enter project description..."
                    maxLength={DESCRIPTION_LIMIT}
                  />
                  {fieldState.invalid && <FormMessage errors={[fieldState.error]} />}
                </Field>
              )}
            />

            <Controller
              control={form.control}
              name="location"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <div className="flex items-center justify-between">
                    <FieldLabel htmlFor="location">Location</FieldLabel>
                    <span className={cn(
                      "text-xs transition-colors",
                      getCounterColor(locationChars, LOCATION_LIMIT)
                    )}>
                      {locationChars}/{LOCATION_LIMIT}
                    </span>
                  </div>
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
                    error={!!fieldState.error}
                    errorMessage={fieldState.error?.message?.toString()}
                    aria-invalid={fieldState.invalid}
                    aria-errormessage={fieldState.error ? "location-error" : undefined}
                  />
                  {fieldState.invalid && <FormMessage errors={[fieldState.error]} />}
                </Field>
              )}
            />

            <Controller
              control={form.control}
              name="require_login"
              render={({ field, fieldState }) => (
                <Field className="flex flex-row items-center justify-between rounded-lg border p-4" data-invalid={fieldState.invalid}>
                  <div className="space-y-0.5">
                    <FieldLabel htmlFor={field.name}>Require Account</FieldLabel>
                    <FieldDescription>
                      Require volunteers to create an account to sign up
                    </FieldDescription>
                  </div>
                  <Switch
                    id={field.name}
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.invalid && <FormMessage errors={[fieldState.error]} />}
                </Field>
              )}
            />

            <Controller
              control={form.control}
              name="waiver_required"
              render={({ field, fieldState }) => (
                <Field className="flex flex-row items-center justify-between rounded-lg border p-4" data-invalid={fieldState.invalid}>
                  <div className="space-y-0.5">
                    <FieldLabel htmlFor={field.name}>Require Waiver Signature</FieldLabel>
                    <FieldDescription>
                      Volunteers must sign your waiver PDF or the global template before signing up.
                    </FieldDescription>
                  </div>
                  <Switch
                    id={field.name}
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.invalid && <FormMessage errors={[fieldState.error]} />}
                </Field>
              )}
            />

            <Controller
              control={form.control}
              name="waiver_allow_upload"
              render={({ field, fieldState }) => (
                <Field className="flex flex-row items-center justify-between rounded-lg border p-4" data-invalid={fieldState.invalid}>
                  <div className="space-y-0.5">
                    <FieldLabel htmlFor={field.name}>Allow Print & Upload</FieldLabel>
                    <FieldDescription>
                      Allow volunteers to upload a signed PDF or image instead of drawing/typing.
                    </FieldDescription>
                  </div>
                  <Switch
                    id={field.name}
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={!waiverRequired}
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.invalid && <FormMessage errors={[fieldState.error]} />}
                </Field>
              )}
            />

            {waiverRequired && (
              <div className="rounded-lg border p-4 space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <Label className="text-sm font-medium">Project Waiver PDF</Label>
                    <CardDescription>
                      Upload a PDF waiver to show volunteers during signup.
                    </CardDescription>
                  </div>
                  {project.waiver_pdf_url && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openPreview(project.waiver_pdf_url!, "Waiver PDF", "application/pdf")}
                      >
                        <Eye className="h-4 w-4 mr-1" />
                        Preview
                      </Button>
                      <a
                        href={project.waiver_pdf_url}
                        download
                        className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                      >
                        <Download className="h-4 w-4 mr-1" />
                        Download
                      </a>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={handleRemoveWaiverPdf}
                        disabled={waiverPdfUploading}
                      >
                        Remove
                      </Button>
                    </div>
                  )}
                </div>

                <input
                  ref={waiverPdfInputRef}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={handleWaiverPdfUpload}
                  disabled={waiverPdfUploading}
                />

                {!project.waiver_pdf_url ? (
                  <div
                    className={cn(
                      "border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:border-primary/50 transition-colors",
                      waiverPdfUploading && "opacity-50 pointer-events-none"
                    )}
                    onClick={() => waiverPdfInputRef.current?.click()}
                  >
                    <div className="flex flex-col items-center gap-2">
                      {waiverPdfUploading ? (
                        <Loader2 className="h-8 w-8 text-muted-foreground animate-spin" />
                      ) : (
                        <Upload className="h-8 w-8 text-muted-foreground" />
                      )}
                      <p className="text-sm font-medium">
                        {waiverPdfUploading ? "Uploading waiver..." : "Click to upload waiver PDF"}
                      </p>
                      <p className="text-xs text-muted-foreground">Max size: {formatBytes(MAX_WAIVER_PDF_SIZE)}</p>
                    </div>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => waiverPdfInputRef.current?.click()}
                    disabled={waiverPdfUploading}
                  >
                    Replace PDF
                  </Button>
                )}

                {waiverPdfError && (
                  <div className="text-sm text-destructive flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />
                    {waiverPdfError}
                  </div>
                )}

                {waiverPdfValidation && (
                  <Alert className={cn(
                    waiverPdfValidation.hasSignatureFields
                      ? "border-green-200 bg-green-50 dark:bg-green-950/20"
                      : "border-amber-200 bg-amber-50 dark:bg-amber-950/20"
                  )}>
                    <AlertDescription className="text-xs">
                      {waiverPdfValidation.hasSignatureFields
                        ? "Signature fields detected. Volunteers can sign directly on the PDF."
                        : waiverPdfValidation.warnings.join(" ")}
                    </AlertDescription>
                  </Alert>
                )}

                {!project.waiver_pdf_url && (
                  <Alert className="bg-blue-50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-900">
                    <AlertDescription className="text-xs text-blue-700 dark:text-blue-400">
                      If you don&apos;t upload a custom waiver, the global platform waiver template will be used instead.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}

            <Controller
              control={form.control}
              name="enable_volunteer_comments"
              render={({ field, fieldState }) => (
                <Field className="flex flex-row items-center justify-between rounded-lg border p-4" data-invalid={fieldState.invalid}>
                  <div className="space-y-0.5">
                    <FieldLabel htmlFor={field.name}>Enable Volunteer Comments</FieldLabel>
                    <FieldDescription>
                      Allow volunteers to include a short note when signing up
                    </FieldDescription>
                  </div>
                  <Switch
                    id={field.name}
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.invalid && <FormMessage errors={[fieldState.error]} />}
                </Field>
              )}
            />

            <Controller
              control={form.control}
              name="show_attendees_publicly"
              render={({ field, fieldState }) => (
                <Field className="flex flex-row items-center justify-between rounded-lg border p-4" data-invalid={fieldState.invalid}>
                  <div className="space-y-0.5">
                    <FieldLabel htmlFor={field.name}>Show Attendees Publicly</FieldLabel>
                    <FieldDescription>
                      Display attendee count on the public project page
                    </FieldDescription>
                  </div>
                  <Switch
                    id={field.name}
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.invalid && <FormMessage errors={[fieldState.error]} />}
                </Field>
              )}
            />

            <Controller
              control={form.control}
              name="verification_method"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>Verification Method</FieldLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <SelectTrigger id={field.name} aria-invalid={fieldState.invalid}>
                      <SelectValue placeholder="Select verification method" />
                    </SelectTrigger>
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
                  {fieldState.invalid && <FormMessage errors={[fieldState.error]} />}
                </Field>
              )}
            />

            <Separator className="my-6" />

            {/* Schedule Section - Collapsible */}
            <Collapsible open={isScheduleOpen} onOpenChange={setIsScheduleOpen}>
              <CollapsibleTrigger
                className={cn(buttonVariants({ variant: "ghost" }), "w-full justify-between p-4 hover:bg-muted/50 h-auto")}
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
                    schedule: scheduleState,
                    recurrence: recurrenceState
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
                  updateRecurrenceAction={updateRecurrence}
                  errors={scheduleErrors}
                />
              </CollapsibleContent>
            </Collapsible>

            <Separator className="my-6" />

            {/* Media & Documents Section - Collapsible */}
            <Collapsible open={isMediaOpen} onOpenChange={setIsMediaOpen}>
              <CollapsibleTrigger
                className={cn(buttonVariants({ variant: "ghost" }), "w-full justify-between p-4 hover:bg-muted/50 h-auto")}
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
                        <AspectRatio ratio={16 / 9} className="bg-muted overflow-hidden rounded-md">
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
                        <div className="rounded-full bg-background p-3 shadow-xs mb-3">
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
                        Upload non-waiver materials like instructions or reference docs (PDF, Word, Text, Images)
                      </p>
                    </div>
                    <div className="text-xs text-muted-foreground text-right">
                      <div>{(project.documents || []).length}/{MAX_DOCUMENTS_COUNT} files</div>
                      <div>{formatBytes(totalDocumentsSize)}/{formatBytes(MAX_DOCUMENT_SIZE)}</div>
                    </div>
                  </div>

                  <div className={`border-2 border-dashed rounded-lg p-4 transition-colors ${(project.documents || []).length >= MAX_DOCUMENTS_COUNT
                    ? 'opacity-50 cursor-not-allowed'
                    : 'hover:border-primary/50 hover:bg-primary/5'
                    }`}>
                    <label className={`flex flex-col items-center justify-center py-6 ${(project.documents || []).length >= MAX_DOCUMENTS_COUNT ? 'cursor-not-allowed' : 'cursor-pointer'
                      }`}>
                      <div className="rounded-full bg-background p-3 shadow-xs mb-3">
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
                          <div className="flex gap-1 shrink-0">
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
                <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                <div className="text-sm text-muted-foreground">
                  <p className="font-medium text-foreground mb-1">This project has been cancelled</p>
                  <p>
                    You can still edit details, but new signups are disabled and the project is marked as cancelled.
                    If this was a mistake, please contact <Link className="text-primary hover:underline" href="mailto:support@lets-assist.com">support@lets-assist.com</Link>
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
                    <XCircle className="h-4 w-4 mr-2 text-warning" />
                    Cancel Project
                  </h4>
                  <p className="text-sm text-muted-foreground mb-4">
                    Cancels the project and emails approved volunteers (including anonymous signups with an email address). The project remains in the system but is marked as cancelled.
                  </p>
                  <Button
                    onClick={() => setShowCancelDialog(true)}
                    className="w-full bg-warning hover:bg-warning/90"
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
                    <TooltipTrigger>
                      <Button
                        variant="destructive"
                        onClick={() => setShowDeleteDialog(true)}
                        className="w-full"
                        asChild
                      >
                        <span className="cursor-pointer">
                          {isDeleting ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          ) : null}
                          Delete Project
                        </span>
                      </Button>
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
              className="w-full sm:w-auto bg-destructive/10 text-destructive hover:bg-destructive/20"
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