"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import { Download, FileText, FileImage, ExternalLink, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";

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
    if (fileType.includes('pdf')) return <FileText className="h-5 w-5 text-chart-7" />;
    if (fileType.includes('image')) return <FileImage className="h-5 w-5 text-info" />;
    return <FileText className="h-5 w-5 text-muted-foreground" />;
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
      // Fallback to simple window open if fetch fails
      window.open(url, '_blank');
    }
  };

  const isPDF = url?.toLowerCase().includes('.pdf');
  const isImage = url?.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i);
  const pdfSrc = isPDF
    ? (url.includes('#')
      ? `${url}&toolbar=0&navpanes=0&view=FitH`
      : `${url}#toolbar=0&navpanes=0&view=FitH`)
    : url;

  if (!url) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="w-[96vw]! max-w-[96vw]! h-[85dvh] rounded-xl p-0 gap-0 overflow-hidden flex flex-col bg-background/95 backdrop-blur-sm border-border/50 shadow-2xl sm:w-[95vw]! sm:max-w-[95vw]! sm:h-[90vh]">
        <VisuallyHidden.Root>
          <DialogTitle>File Preview: {fileName}</DialogTitle>
        </VisuallyHidden.Root>

        {/* Header Toolbar */}
        <div className="flex items-center justify-between px-3 py-2 sm:px-4 sm:py-3 border-b bg-muted/30 backdrop-blur-md z-10 shrink-0">
          <div className="flex items-center gap-2 sm:gap-3 overflow-hidden">
            <div className="shrink-0 p-1.5 sm:p-2 bg-background rounded-md shadow-sm border">
              {getFileIcon()}
            </div>
            <div className="flex flex-col overflow-hidden">
              <span className="font-semibold text-xs sm:text-sm truncate" title={fileName}>
                {fileName}
              </span>
              <span className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider">
                {fileType.split('/')[1] || 'FILE'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="hidden sm:flex"
              onClick={() => window.open(url, '_blank')}
              title="Open in new tab"
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => downloadFile(url, fileName)}
              title="Download"
            >
              <Download className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Content Area */}
        <div className={cn(
          "flex-1 relative w-full h-full overflow-hidden bg-dot-pattern",
          isPDF ? "bg-slate-100 dark:bg-slate-900" : "bg-neutral-50/50 dark:bg-neutral-900/50"
        )}>
          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/50 z-20 backdrop-blur-sm">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="mt-2 text-sm text-muted-foreground animate-pulse">Loading preview...</p>
            </div>
          )}

          {isPDF ? (
            <iframe
              src={pdfSrc}
              className="w-full h-full border-0"
              onLoad={() => setLoading(false)}
              title={`Preview of ${fileName}`}
            />
          ) : isImage ? (
            <div className="relative w-full h-full flex items-center justify-center p-0 sm:p-4">
              <Image
                src={url}
                alt={fileName}
                fill
                className="object-contain"
                onLoad={() => setLoading(false)}
                onError={() => setLoading(false)}
                quality={85}
              />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full p-6 sm:p-8 text-center animate-in fade-in zoom-in-95 duration-300">
              <div className="h-20 w-20 sm:h-24 sm:w-24 rounded-2xl bg-muted flex items-center justify-center mb-4 sm:mb-6 shadow-inner ring-1 ring-border">
                <FileText className="h-10 w-10 sm:h-12 sm:w-12 text-muted-foreground/50" />
              </div>
              <h3 className="text-base sm:text-lg font-medium">Preview not available</h3>
              <p className="text-xs sm:text-sm text-muted-foreground mt-2 max-w-xs mx-auto mb-6 sm:mb-8">
                This file type cannot be previewed directly in the browser.
              </p>
              <Button onClick={() => downloadFile(url, fileName)} size="lg" className="shadow-lg">
                <Download className="h-4 w-4 mr-2" />
                Download File
              </Button>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-3 py-2 sm:px-4 sm:py-3 border-t bg-muted/20 shrink-0">
          <DialogClose render={<Button type="button">Close</Button>} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
