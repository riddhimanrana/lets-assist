"use client";

import { Project, ProjectDocument } from "@/types";
import { useRouter } from "next/navigation";
import { useState, useCallback, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  FileText,
  File,
  FileImage,
  Loader2,
  Upload,
  Trash2,
  Eye,
  AlertTriangle,
  ImageIcon,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { updateProject } from "../actions";
import { cn, formatBytes } from "@/lib/utils";
import FilePreview from "@/components/FilePreview";
import Image from "next/image";
import { AspectRatio } from "@/components/ui/aspect-ratio";

interface Props {
  project: Project;
}

// Constants for file validations
const MAX_cover_image_url_SIZE = 5 * 1024 * 1024; // 5MB
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

export default function DocumentsClient({ project }: Props) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewDocName, setPreviewDocName] = useState<string>("Document");
  const [previewDocType, setPreviewDocType] = useState<string>("");
  const [dragActive, setDragActive] = useState<"cover" | "docs" | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [hoverUpload, setHoverUpload] = useState<"cover" | "docs" | null>(null);
  const [coverImagePreview, setCoverImagePreview] = useState<string | null>(null);
  const [totalDocumentsSize, setTotalDocumentsSize] = useState<number>(0);

  // Calculate total documents size whenever documents change
  useEffect(() => {
    const totalSize = (project.documents || []).reduce((sum, doc) => sum + (doc.size || 0), 0);
    setTotalDocumentsSize(totalSize);
  }, [project.documents]);

  // Helper function to get upload area styling
  const getUploadAreaClassName = (type: "cover" | "docs") => {
    const baseClass = "border-2 border-dashed rounded-lg relative flex flex-col items-center justify-center p-6 transition-colors";
    
    if (dragActive === type) {
      return `${baseClass} border-primary bg-primary/5`;
    } else if (hoverUpload === type) {
      return `${baseClass} border-muted-foreground/25 bg-muted/50`;
    } else {
      return `${baseClass} border-muted-foreground/25 hover:border-primary/50 hover:bg-primary/5`;
    }
  };

  const validateDocument = (file: File, existingFilesCount: number = 0): boolean => {
    if (!ALLOWED_DOCUMENT_TYPES.includes(file.type)) {
      toast.error("Invalid file type");
      return false;
    }
    
    const currentTotalSize = (project.documents || []).reduce((sum, doc) => sum + (doc.size || 0), 0);
    if (currentTotalSize + file.size > MAX_DOCUMENT_SIZE) {
      toast.error("Total size limit exceeded");
      return false;
    }
    
    if ((project.documents || []).length + existingFilesCount >= MAX_DOCUMENTS_COUNT) {
      toast.error("Maximum files reached");
      return false;
    }
    
    return true;
  };

  // Add validateImage function
  const validateImage = (file: File): boolean => {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      toast.error("Invalid file type");
      return false;
    }
    
    if (file.size > MAX_cover_image_url_SIZE) {
      toast.error("File too large");
      return false;
    }
    
    return true;
  };

  // Add cover image handlers
  const handleCoverImageDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(null);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (validateImage(file)) {
        const loadingToast = toast.loading("Uploading cover image...");
        try {
          const supabase = createClient();
          const fileExt = file.name.split('.').pop();
          const fileName = `${Math.random().toString(36).substring(2)}.${fileExt}`;

          const { error: uploadError } = await supabase.storage
            .from('project-images')
            .upload(fileName, file);

          if (uploadError) throw uploadError;

          const { data: urlData } = supabase.storage
            .from('project-images')
            .getPublicUrl(fileName);

          // Update project with new cover image
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
          setUploading(false);
        }
      }
    }
  };

  const handleCoverImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      
      if (validateImage(file)) {
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

          // Update project with new cover image
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
          setUploading(false);
        }
      }
    }
  };

  const removeCoverImage = async () => {
    try {
      if (project.cover_image_url) {
        const supabase = createClient();
        const urlParts = new URL(project.cover_image_url);
        const pathParts = urlParts.pathname.split("/");
        const fileName = pathParts[pathParts.length - 1];

        const { error: deleteError } = await supabase.storage
          .from('project-images')
          .remove([fileName]);

        if (deleteError) throw deleteError;

        const result = await updateProject(project.id, {
          cover_image_url: null
        });

        if (result.error) throw new Error(result.error);

        toast.success("Cover image removed successfully");
        router.refresh();
      }
    } catch (error) {
      console.error('Delete error:', error);
      toast.error("Failed to remove cover image");
    }
  };

  // Update drag and drop handlers for both cover image and documents
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

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(null);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFiles = Array.from(e.dataTransfer.files);
      const totalFiles = (project.documents || []).length + droppedFiles.length;

      if (totalFiles > MAX_DOCUMENTS_COUNT) {
        toast.error("Maximum files reached");
        return;
      }

      handleFiles(droppedFiles);
    }
  }, [project.documents]);

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;

    // Calculate total number of files first
    const totalFiles = (project.documents || []).length + files.length;
    if (totalFiles > MAX_DOCUMENTS_COUNT) {
      toast.error("Maximum files reached");
      return;
    }

    // Check if adding these files would exceed the total size limit
    const currentTotalSize = (project.documents || []).reduce((sum, doc) => sum + (doc.size || 0), 0);
    const newFilesTotalSize = files.reduce((sum, file) => sum + file.size, 0);
    if (currentTotalSize + newFilesTotalSize > MAX_DOCUMENT_SIZE) {
      toast.error("Total size limit exceeded");
      return;
    }

    setUploading(true);
    const supabase = createClient();

    try {
      const newDocs: ProjectDocument[] = [];
      const existingDocs = project.documents || [];
      const loadingToast = toast.loading("Preparing to upload files...");

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        // Update loading message for each file
        toast.loading(`Uploading file ${i + 1} of ${files.length}: ${file.name}...`, {
          id: loadingToast
        });

        if (validateDocument(file, newDocs.length)) {
          const fileExt = file.name.split('.').pop();
          const fileName = `${Math.random().toString(36).substring(2)}.${fileExt}`;

          const { error: uploadError } = await supabase.storage
            .from('project-documents')
            .upload(fileName, file);

          if (uploadError) throw uploadError;

          const { data: urlData } = supabase.storage
            .from('project-documents')
            .getPublicUrl(fileName);

          newDocs.push({
            name: file.name,
            originalName: file.name,
            type: file.type,
            size: file.size,
            url: urlData.publicUrl,
          });
        }

        // Add a small delay between uploads to prevent race conditions
        if (i < files.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }

        // Stop if the total number of files reaches the limit
        if (newDocs.length >= MAX_DOCUMENTS_COUNT) {
          toast.error("Maximum files reached");
          break;
        }
      }

      if (newDocs.length > 0) {
        toast.loading("Finalizing upload...", { id: loadingToast });
        
        // Update project with new documents
        const result = await updateProject(project.id, {
          documents: [...existingDocs, ...newDocs],
        });

        if (result.error) throw new Error(result.error);

        toast.success(`Successfully uploaded ${newDocs.length} ${newDocs.length === 1 ? 'file' : 'files'}`, {
          id: loadingToast
        });
        router.refresh();
      }
    } catch (error) {
      console.error('Upload error:', error);
      toast.error("Failed to upload documents");
    } finally {
      setUploading(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFiles = Array.from(e.target.files);
      const totalFiles = (project.documents || []).length + selectedFiles.length;

      if (totalFiles > MAX_DOCUMENTS_COUNT) {
        toast.error("Maximum files reached");
        return;
      }

      handleFiles(selectedFiles);
    }
  };

  const handleDeleteDocument = async (docUrl: string) => {
    try {
      const supabase = createClient();

      // Delete from storage
      const urlParts = new URL(docUrl);
      const pathParts = urlParts.pathname.split("/");
      const fileName = pathParts[pathParts.length - 1];

      const { error: storageError } = await supabase.storage
        .from('project-documents')
        .remove([fileName]);

      if (storageError) throw storageError;

      // Update project documents
      const updatedDocs = (project.documents || []).filter(
        (doc) => doc.url !== docUrl
      );

      const result = await updateProject(project.id, {
        documents: updatedDocs,
      });

      if (result.error) throw new Error(result.error);

      toast.success("Document deleted successfully");
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

  return (
    <div className="container mx-auto px-4 py-6 max-w-4xl">
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
          <CardTitle>Project Files</CardTitle>
          <CardDescription>
            Manage your project&apos;s cover image and documents
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Cover Image Upload */}
          <div className="space-y-2">
            <h4 className="font-medium">Cover Image</h4>
            <p className="text-xs text-muted-foreground">Upload a cover image for your project (JPEG, JPG, PNG, WebP, max 5MB)</p>
            <div 
              className={getUploadAreaClassName("cover")}
              onDragOver={(e) => handleDragOver(e, "cover")}
              onDragLeave={handleDragLeave}
              onDrop={handleCoverImageDrop}
              onMouseEnter={() => !project.cover_image_url && setHoverUpload("cover")}
              onMouseLeave={() => setHoverUpload(null)}
            >
              {project.cover_image_url ? (
                <div className="w-full max-w-md mx-auto">
                  <AspectRatio ratio={4/3} className="bg-muted overflow-hidden rounded-md">
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
                        className="absolute top-2 right-2 h-7 w-7 shadow-md hover:bg-destructive/90 transition-colors"
                        onClick={removeCoverImage}
                        disabled={uploading}
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
                      <p className="text-sm font-medium">
                        {uploading ? "Uploading..." : "Drag & drop your cover image here"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {uploading ? "Please wait..." : "or click to browse"}
                      </p>
                    </div>
                  </div>
                  <input
                    type="file"
                    id="coverImage"
                    accept={ALLOWED_IMAGE_TYPES.join(",")}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
                    onChange={handleCoverImageChange}
                    disabled={uploading}
                  />
                </>
              )}
            </div>
            <div className="flex items-center mt-2 text-xs text-muted-foreground">
              <AlertTriangle className="h-3 w-3 mr-1 flex-shrink-0" />
              <span>Cover images are optional, but if you have an image feel free to show it!</span>
            </div>
          </div>

          {/* Supporting Documents Upload */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <h4 className="font-medium">Supporting Documents</h4>
              <div className="text-xs text-muted-foreground">
                {`${(project.documents || []).length}/${MAX_DOCUMENTS_COUNT} files • ${formatBytes(totalDocumentsSize)}/${formatBytes(MAX_DOCUMENT_SIZE)}`}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Upload permission slips, waivers, instructions or images (PDF, Word, Text, Images, max 10MB total)</p>
            <div
              className={`${getUploadAreaClassName("docs")} min-h-[180px] ${(project.documents || []).length >= MAX_DOCUMENTS_COUNT ? 'opacity-50 pointer-events-none' : ''}`}
              onDragOver={(e) => handleDragOver(e, "docs")}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onMouseEnter={() => setHoverUpload("docs")}
              onMouseLeave={() => setHoverUpload(null)}
            >
              <div className="flex flex-col items-center justify-center space-y-2 my-6">
                <div className="rounded-full bg-background p-2 shadow-sm">
                  <Upload className="h-6 w-6 text-muted-foreground" />
                </div>
                <div className="text-center space-y-1">
                  <p className="text-sm font-medium">
                    {(project.documents || []).length >= MAX_DOCUMENTS_COUNT 
                      ? "Maximum files reached" 
                      : "Drag & drop files here"
                    }
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {(project.documents || []).length >= MAX_DOCUMENTS_COUNT 
                      ? `Limit of ${MAX_DOCUMENTS_COUNT} files reached`
                      : "or click to browse"
                    }
                  </p>
                </div>
                <input
                  type="file"
                  multiple
                  id="documents"
                  accept={ALLOWED_DOCUMENT_TYPES.join(",")}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
                  onChange={handleFileSelect}
                  disabled={uploading || (project.documents || []).length >= MAX_DOCUMENTS_COUNT}
                />
              </div>
            </div>

            {/* Documents List */}
            {project.documents && project.documents.length > 0 ? (
              <div className="w-full space-y-2 mt-4">
                <div className="space-y-2">
                  {project.documents.map((doc, index) => (
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
                          <p className="text-xs text-muted-foreground">{formatBytes(doc.size)}</p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {isPreviewable(doc.type) && (
                          <Button
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
              </div>
            ) : (
              <div className="flex items-center mt-2 text-xs text-muted-foreground">
                <AlertTriangle className="h-3 w-3 mr-1 flex-shrink-0" />
                <span>Documents are optional but recommended for projects requiring additional information</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

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