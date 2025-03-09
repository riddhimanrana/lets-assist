// Finalize.tsx - Final review step for project creation

"use client";

import { useState, useCallback, useEffect } from "react";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  MapPin,
  Calendar,
  Clock,
  Users,
  QrCode,
  UserCheck,
  Lock,
  User,
  Image as ImageIcon,
  FileText,
  X,
  Upload,
  FileType,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { toast } from "sonner";
import { RichTextContent } from "@/components/ui/rich-text-content";

// Maximum file sizes
const MAX_COVER_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_DOCUMENTS_COUNT = 5;

// Allowed file types
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/jpg"];
const ALLOWED_DOCUMENT_TYPES = [
  "application/pdf", 
  "application/msword", 
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 
  "text/plain",
  "image/jpeg", 
  "image/png", 
  "image/webp", 
  "image/jpg"
];

interface FinalizeProps {
  state: {
    eventType: string;
    verificationMethod: string;
    requireLogin: boolean;
    basicInfo: {
      title: string;
      location: string;
      description: string;
    };
    schedule: {
      oneTime: {
        date: string;
        startTime: string;
        endTime: string;
        volunteers: number;
      };
      multiDay: {
        date: string;
        slots: { startTime: string; endTime: string; volunteers: number }[];
      }[];
      sameDayMultiArea: {
        date: string;
        overallStart: string;
        overallEnd: string;
        roles: {
          name: string;
          startTime: string;
          endTime: string;
          volunteers: number;
        }[];
      };
    };
  };
  setCoverImage: (file: File | null) => void;
  setDocuments: (docs: File[]) => void;
}

export default function Finalize({ state, setCoverImage, setDocuments }: FinalizeProps) {
  const [coverImagePreview, setCoverImagePreview] = useState<string | null>(null);
  const [localDocuments, setLocalDocuments] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState<"cover" | "docs" | null>(null);
  const [totalDocumentsSize, setTotalDocumentsSize] = useState<number>(0);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [hoverUpload, setHoverUpload] = useState<"cover" | "docs" | null>(null);
  
  // Calculate total documents size whenever localDocuments change
  useEffect(() => {
    const totalSize = localDocuments.reduce((sum, doc) => sum + doc.size, 0);
    setTotalDocumentsSize(totalSize);
  }, [localDocuments]);

  // Helper function to parse date string to Date object without timezone shifting
  const parseStringToDate = (dateString: string): Date | undefined => {
    if (!dateString) return undefined;
    const [year, month, day] = dateString.split("-").map(Number);
    return new Date(year, month - 1, day); // month is 0-indexed in JavaScript Date
  };

  // Helper function to format date for display
  const formatDateForDisplay = (dateString: string): string => {
    if (!dateString) return "Date not set";
    const date = parseStringToDate(dateString);
    return date ? format(date, "EEEE, MMMM d, yyyy") : "Date not set";
  };

  // Helper function to convert 24-hour time to 12-hour time with AM/PM
  const convertTo12HourFormat = (time: string): string => {
    const [hour, minute] = time.split(":").map(Number);
    const period = hour >= 12 ? "PM" : "AM";
    const adjustedHour = hour % 12 || 12; // Convert 0 to 12 for 12 AM
    return `${adjustedHour}:${minute.toString().padStart(2, "0")} ${period}`;
  };

  // Format verification method for display
  const getVerificationMethodDisplay = (method: string) => {
    switch (method) {
      case "qr-code":
        return {
          name: "QR Code Self Check-in",
          icon: <QrCode className="h-4 w-4 mr-2" />,
          description:
            "Volunteers will scan a QR code and log their own hours.",
        };
      case "auto":
        return {
          name: "Automatic Check-in/out",
          icon: <Clock className="h-4 w-4 mr-2" />,
          description:
            "System will automatically log attendance for the full scheduled time.",
        };
      case "manual":
        return {
          name: "Manual Check-in by Organizer",
          icon: <UserCheck className="h-4 w-4 mr-2" />,
          description:
            "You will manually log each volunteer's attendance and hours.",
        };
      default:
        return {
          name: "Not specified",
          icon: null,
          description: "",
        };
    }
  };

  const verificationMethod = getVerificationMethodDisplay(
    state.verificationMethod,
  );

  // File validation helpers
  const validateImage = (file: File): boolean => {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      toast.error("Invalid file type", {
        description: "Please upload a JPEG, JPG, PNG or WebP image"
      });
      return false;
    }
    
    if (file.size > MAX_COVER_IMAGE_SIZE) {
      toast.error("File too large", {
        description: "Cover image must be less than 5MB"
      });
      return false;
    }
    
    return true;
  };
  
  const validateDocument = (file: File, existingFiles: File[] = []): boolean => {
    if (!ALLOWED_DOCUMENT_TYPES.includes(file.type)) {
      toast.error("Invalid file type", {
        description: "Please upload a PDF, Word document, text file or image"
      });
      return false;
    }
    
    if (file.size > MAX_DOCUMENT_SIZE) {
      toast.error("File too large", {
        description: "Each document must be less than 10MB"
      });
      return false;
    }
    
    // Check if adding this file would exceed the total documents size limit
    const currentTotalSize = existingFiles.reduce((sum, doc) => sum + doc.size, 0);
    if (currentTotalSize + file.size > MAX_DOCUMENT_SIZE) {
      toast.error("Total size limit exceeded", {
        description: "Total documents size must not exceed 10MB"
      });
      return false;
    }
    
    // Check if adding this file would exceed the max count
    if (existingFiles.length >= MAX_DOCUMENTS_COUNT) {
      toast.error("Maximum files reached", {
        description: `You can upload a maximum of ${MAX_DOCUMENTS_COUNT} documents`
      });
      return false;
    }
    
    return true;
  };

  // File handlers
  const handleCoverImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      
      if (validateImage(file)) {
        setCoverImage(file);
        const fileReader = new FileReader();
        fileReader.onload = (e) => {
          if (e.target?.result) {
            setCoverImagePreview(e.target.result as string);
          }
        };
        fileReader.readAsDataURL(file);
      }
    }
  };
  
  const handleDocumentsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      
      // Check if adding these files would exceed the max count
      if (localDocuments.length + newFiles.length > MAX_DOCUMENTS_COUNT) {
        toast.error("Maximum files reached", {
          description: `You can upload a maximum of ${MAX_DOCUMENTS_COUNT} documents (${MAX_DOCUMENTS_COUNT - localDocuments.length} remaining)`
        });
        return;
      }
      
      // Validate each file individually
      const validFiles: File[] = [];
      
      for (const file of newFiles) {
        if (validateDocument(file, [...localDocuments, ...validFiles])) {
          validFiles.push(file);
        }
      }
      
      if (validFiles.length > 0) {
        const updatedDocs = [...localDocuments, ...validFiles];
        setLocalDocuments(updatedDocs);
        setDocuments(updatedDocs);
      }
    }
  };
  
  const removeDocument = (index: number) => {
    const updatedDocs = localDocuments.filter((_, i) => i !== index);
    setLocalDocuments(updatedDocs);
    setDocuments(updatedDocs);
  };
  
  const removeCoverImage = () => {
    setCoverImage(null);
    setCoverImagePreview(null);
  };

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent, dropZone: "cover" | "docs") => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(dropZone);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(null);
  }, []);

  const handleCoverImageDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(null);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      
      if (validateImage(file)) {
        setCoverImage(file);
        const fileReader = new FileReader();
        fileReader.onload = (e) => {
          if (e.target?.result) {
            setCoverImagePreview(e.target.result as string);
          }
        };
        fileReader.readAsDataURL(file);
      }
    }
  }, [setCoverImage]);

  const handleDocumentsDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(null);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const newFiles = Array.from(e.dataTransfer.files);
      
      // Check if adding these files would exceed the max count
      if (localDocuments.length + newFiles.length > MAX_DOCUMENTS_COUNT) {
        toast.error("Maximum files reached", {
          description: `You can upload a maximum of ${MAX_DOCUMENTS_COUNT} documents (${MAX_DOCUMENTS_COUNT - localDocuments.length} remaining)`
        });
        return;
      }
      
      // Validate each file individually
      const validFiles: File[] = [];
      
      for (const file of newFiles) {
        if (validateDocument(file, [...localDocuments, ...validFiles])) {
          validFiles.push(file);
        }
      }
      
      if (validFiles.length > 0) {
        const updatedDocs = [...localDocuments, ...validFiles];
        setLocalDocuments(updatedDocs);
        setDocuments(updatedDocs);
      }
    }
  }, [localDocuments, setDocuments]);

  // Get file icon based on type
  const getFileIcon = (fileType: string) => {
    if (fileType.includes("pdf")) {
      return <FileText className="h-5 w-5" />;
    } else if (fileType.includes("word") || fileType.includes("doc")) {
      return <FileText className="h-5 w-5" />;
    } else if (fileType.includes("text")) {
      return <FileText className="h-5 w-5" />;
    } else if (fileType.includes("image")) {
      return <ImageIcon className="h-5 w-5" />;
    } else {
      return <FileType className="h-5 w-5" />;
    }
  };

  // Helper function to format file size
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + " B";
    else if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    else return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  // Helper function for determining upload area styling
  const getUploadAreaClassName = (type: "cover" | "docs") => {
    const baseClass = "border-2 border-dashed rounded-lg relative flex flex-col items-center justify-center p-6 transition-colors";
    
    if (dragActive === type) {
      return `${baseClass} border-primary bg-primary/5`;
    } else if (hoverUpload === type) {
      return `${baseClass} border-muted-foreground/25 bg-muted/50`;
    } else {
      return `${baseClass} border-muted-foreground/25`;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Review Your Project</CardTitle>
        <p className="text-sm text-muted-foreground">
          Please review your project details before creating
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* File Upload Sections */}
        <div className="space-y-6">
          {/* Cover Image Upload */}
          <div className="space-y-2">
            <h4 className="font-medium">Cover Image</h4>
            <p className="text-xs text-muted-foreground">Upload a cover image for your project (JPEG, JPG, PNG, WebP, max 5MB)</p>
            <div 
              className={getUploadAreaClassName("cover")}
              onDragOver={(e) => handleDragOver(e, "cover")}
              onDragLeave={handleDragLeave}
              onDrop={handleCoverImageDrop}
              onMouseEnter={() => !coverImagePreview && setHoverUpload("cover")}
              onMouseLeave={() => setHoverUpload(null)}
            >
              {coverImagePreview ? (
                <div className="w-full max-w-md mx-auto">
                  <AspectRatio ratio={4/3} className="bg-muted overflow-hidden rounded-md">
                    <div className="relative w-full h-full">
                      <Image
                        src={coverImagePreview}
                        alt="Cover image preview"
                        fill
                        className="object-cover rounded-md"
                      />
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        className="absolute top-2 right-2 h-7 w-7 shadow-md hover:bg-destructive/90 transition-colors"
                        onClick={removeCoverImage}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </AspectRatio>
                </div>
              ) : (
                <>
                  <div className="flex flex-col items-center justify-center space-y-2 py-6">
                    <div className="rounded-full bg-background p-2 shadow-sm">
                      <ImageIcon className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <div className="text-center space-y-1">
                      <p className="text-sm font-medium">Drag & drop your cover image here</p>
                      <p className="text-xs text-muted-foreground">or click to browse</p>
                    </div>
                  </div>
                  <input
                    type="file"
                    id="coverImage"
                    accept={ALLOWED_IMAGE_TYPES.join(",")}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    onChange={handleCoverImageChange}
                  />
                </>
              )}
              
            </div>
            <div className="flex items-center mt-2 text-xs text-muted-foreground">
                <AlertTriangle className="h-3 w-3 mr-1" />
                <span>Cover images are optional, but if you have an image feel free to show it!</span>
              </div>
          </div>

          {/* Supporting Documents Upload */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <h4 className="font-medium">Supporting Documents</h4>
              <div className="text-xs text-muted-foreground">
                {localDocuments.length}/{MAX_DOCUMENTS_COUNT} files • {formatFileSize(totalDocumentsSize)}/{formatFileSize(MAX_DOCUMENT_SIZE)}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Upload permission slips, waivers, instructions or images (PDF, Word, Text, Images, max 10MB total)</p>
            <div 
              className={`${getUploadAreaClassName("docs")} min-h-[180px] ${localDocuments.length >= MAX_DOCUMENTS_COUNT ? 'opacity-50 pointer-events-none' : ''}`}
              onDragOver={(e) => handleDragOver(e, "docs")}
              onDragLeave={handleDragLeave}
              onDrop={handleDocumentsDrop}
              onMouseEnter={() => setHoverUpload("docs")}
              onMouseLeave={() => setHoverUpload(null)}
            >
              <div className="flex flex-col items-center justify-center space-y-2 my-6">
                <div className="rounded-full bg-background p-2 shadow-sm">
                  <Upload className="h-6 w-6 text-muted-foreground" />
                </div>
                <div className="text-center space-y-1">
                  <p className="text-sm font-medium">Drag & drop files here</p>
                  <p className="text-xs text-muted-foreground">or click to browse</p>
                </div>
                {localDocuments.length < MAX_DOCUMENTS_COUNT && (
                  <input
                    type="file"
                    multiple
                    id="documents"
                    accept={ALLOWED_DOCUMENT_TYPES.join(",")}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    onChange={handleDocumentsChange}
                  />
                )}
              </div>
            </div>
            
            {localDocuments.length > 0 && (
              <div className="w-full space-y-2 mt-4">
                <p className="text-sm font-medium">Uploaded Documents</p>
                <div className="space-y-2">
                  {localDocuments.map((doc, index) => (
                    <div 
                      key={index} 
                      className={`flex items-center justify-between p-3 rounded-md ${hoverIndex === index ? 'bg-muted/80' : 'bg-muted/40'} transition-colors`}
                      onMouseEnter={() => setHoverIndex(index)}
                      onMouseLeave={() => setHoverIndex(null)}
                    >
                      <div className="flex items-center space-x-3">
                        {getFileIcon(doc.type)}
                        <div>
                          <p className="text-sm font-medium truncate max-w-[200px] sm:max-w-[300px]">{doc.name}</p>
                          <p className="text-xs text-muted-foreground">{formatFileSize(doc.size)}</p>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant={hoverIndex === index ? "destructive" : "ghost"}
                        size="icon"
                        className="h-8 w-8 transition-colors"
                        onClick={() => removeDocument(index)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {!localDocuments.length && (
              <div className="flex items-center mt-2 text-xs text-muted-foreground">
                <AlertTriangle className="h-3 w-3 mr-1" />
                <span>Documents are optional but recommended for projects requiring additional information</span>
              </div>
            )}
          </div>
        </div>
        
        <Separator />

        <div>
          <h3 className="text-lg font-semibold mb-1">
            {state.basicInfo.title}
          </h3>
          <div className="flex items-start gap-2 text-muted-foreground mb-4">
            <MapPin className="h-4 w-4 mt-0.5 shrink-0" />
            <span className="text-sm">{state.basicInfo.location}</span>
          </div>
          <RichTextContent content={state.basicInfo.description} className="text-sm" />
        </div>

        <div className="bg-muted/50 p-4 rounded-lg space-y-4">
          <h4 className="font-medium">Event Type</h4>
          <Badge variant="outline" className="text-xs">
            {state.eventType === "oneTime" && "Single Event"}
            {state.eventType === "multiDay" && "Multiple Day Event"}
            {state.eventType === "sameDayMultiArea" && "Multi-Role Event"}
          </Badge>

          <h4 className="font-medium pt-2">Verification Method</h4>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="text-xs flex items-center gap-1"
            >
              {verificationMethod.icon}
              {verificationMethod.name}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {verificationMethod.description}
          </p>

          <h4 className="font-medium pt-2">Sign-up Requirements</h4>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="text-xs flex items-center gap-1"
            >
              {state.requireLogin ? (
                <>
                  <Lock className="h-4 w-4 mr-1" />
                  Account Required
                </>
              ) : (
                <>
                  <User className="h-4 w-4 mr-1" />
                  Anonymous Sign-ups Allowed
                </>
              )}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {state.requireLogin
              ? "Volunteers must create an account to sign up for your event."
              : "Anyone can sign up without creating an account (anonymous volunteers)."}
          </p>

          {state.eventType === "oneTime" && (
            <div className="space-y-2 pt-2">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">
                  {formatDateForDisplay(state.schedule.oneTime.date)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">
                  {convertTo12HourFormat(state.schedule.oneTime.startTime)} -{" "}
                  {convertTo12HourFormat(state.schedule.oneTime.endTime)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">
                  {state.schedule.oneTime.volunteers} volunteer
                  {state.schedule.oneTime.volunteers !== 1 && "s"} needed
                </span>
              </div>
            </div>
          )}

          {state.eventType === "multiDay" && (
            <div className="space-y-4 pt-2">
              {state.schedule.multiDay.map((day, dayIndex) => (
                <div key={dayIndex} className="space-y-2 border-l-2 pl-3">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">
                      {formatDateForDisplay(day.date)}
                    </span>
                  </div>
                  {day.slots.map((slot, slotIndex) => (
                    <div key={slotIndex} className="ml-6 space-y-1">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">
                          {convertTo12HourFormat(slot.startTime)} - {convertTo12HourFormat(slot.endTime)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">
                          {slot.volunteers} volunteer
                          {slot.volunteers !== 1 && "s"} needed
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {state.eventType === "sameDayMultiArea" && (
            <div className="space-y-4 pt-2">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">
                  {formatDateForDisplay(state.schedule.sameDayMultiArea.date)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">
                  Overall hours: {convertTo12HourFormat(state.schedule.sameDayMultiArea.overallStart)}{" "}
                  - {convertTo12HourFormat(state.schedule.sameDayMultiArea.overallEnd)}
                </span>
              </div>
              <Separator className="my-2" />
              <h5 className="font-medium text-sm">Roles:</h5>
              <div className="space-y-4">
                {state.schedule.sameDayMultiArea.roles.map(
                  (role, roleIndex) => (
                    <div key={roleIndex} className="space-y-1 border-l-2 pl-3">
                      <span className="text-sm font-medium">
                        {role.name || `Role ${roleIndex + 1}`}
                      </span>
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">
                          {convertTo12HourFormat(role.startTime)} - {convertTo12HourFormat(role.endTime)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">
                          {role.volunteers} volunteer
                          {role.volunteers !== 1 && "s"} needed
                        </span>
                      </div>
                    </div>
                  ),
                )}
              </div>
            </div>
          )}
        </div>

        <div className="rounded-lg border p-4 flex items-start gap-4">
          <CheckCircle2 className="flex-shrink-0 h-8 w-8 text-primary mt-0.5" />
          <div>
            <h4 className="font-semibold">Ready to create your project</h4>
            <p className="text-sm text-muted-foreground">
              Click the &quot;Create&quot; button below to publish this project
              and start accepting volunteers.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
