"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogTitle, DialogHeader } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import { X, Download, FileText, FileImage, File } from "lucide-react";
import { cn } from "@/lib/utils";

interface FilePreviewProps {
  url: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileName?: string;
  fileType?: string;
}

export default function FilePreview({
  url,
  open,
  onOpenChange,
  fileName = "Document",
  fileType = "",
}: FilePreviewProps) {
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    if (open) {
      setLoading(true);
    }
  }, [open, url]);

  const getFileIcon = () => {
    if (fileType.includes('pdf')) return <FileText className="h-5 w-5" />;
    if (fileType.includes('image')) return <FileImage className="h-5 w-5" />;
    return <FileText className="h-5 w-5" />;
  };
  
  const downloadFile = async (url: string, filename: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(href);
    } catch (error) {
      console.error('Download error:', error);
    }
  };

  const isPDF = url?.toLowerCase().includes('.pdf');
  const isImage = url?.match(/\.(jpg|jpeg|png|gif|webp)$/i);

  if (!url) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-full sm:max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex items-center justify-between flex-row">
          <DialogTitle className="flex items-center gap-2 truncate pr-4">
            {getFileIcon()}
            <span className="truncate">{fileName}</span>
          </DialogTitle>
        </DialogHeader>
        
        <div className={cn("flex-1 mt-2 p-2 rounded-md overflow-hidden relative", 
          isPDF ? "bg-popover" : "")}>
          {loading && <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
          </div>}
          
            {isPDF ? (
            <iframe 
              src={`${url}#toolbar=0&navpanes=0`} 
              className="w-full h-[50vh] sm:h-[80vh] rounded border"
              onLoad={() => setLoading(false)}
              title="PDF Preview"
            />
            ) : isImage ? (
            <div className="flex items-center justify-center h-full min-h-[50vh] sm:min-h-[80vh] p-2">
              <Image 
              src={url} 
              alt="Document preview" 
              width={1200} 
              height={800}
              className="max-w-full max-h-[80vh] object-contain"
              onLoad={() => setLoading(false)}
              />
            </div>
            ) : (
            <div className="flex flex-col items-center justify-center h-full min-h-[50vh] sm:min-h-[80vh] p-4">
              <FileText className="h-16 w-16 text-muted-foreground" />
              <p className="text-muted-foreground mt-4 text-center">
              This file cannot be previewed
              </p>
              <Button 
              variant="outline" 
              className="mt-4"
              onClick={() => url && downloadFile(url, fileName)}
              >
              <Download className="h-4 w-4 mr-2" />
              Download
              </Button>
            </div>
            )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
