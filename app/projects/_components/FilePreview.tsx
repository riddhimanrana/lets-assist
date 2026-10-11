"use client";
import { safeConsole } from "@/lib/safe-console";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import {
  Download,
  FileText,
  FileImage,
  ExternalLink,
  Loader2,
} from "lucide-react";
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
  const path = (url ?? "").split(/[?#]/)[0];
  const isPDF = fileType === "application/pdf" || /\.pdf$/i.test(path);
  const isImage =
    fileType.startsWith("image/") ||
    /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(path);
  const canPreview = isPDF || isImage;
  const [loading, setLoading] = useState(canPreview);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);

  useEffect(() => {
    if (open) {
      setLoading(canPreview);
      setPreviewFailed(false);
      setDownloadFailed(false);
    }
  }, [open, url, fileType, canPreview]);

  const getFileIcon = () => {
    if (fileType.includes("pdf"))
      return <FileText className="h-5 w-5 text-chart-7" />;
    if (fileType.includes("image"))
      return <FileImage className="h-5 w-5 text-info" />;
    return <FileText className="h-5 w-5 text-muted-foreground" />;
  };

  const downloadFile = async (url: string, filename: string) => {
    setDownloadFailed(false);
    let href: string | undefined;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("File download failed");
      const blob = await response.blob();
      href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = filename;
      document.body.appendChild(link);
      try {
        link.click();
      } finally {
        document.body.removeChild(link);
      }
    } catch (error) {
      safeConsole.error("Download error:", error);
      setDownloadFailed(true);
    } finally {
      if (href) URL.revokeObjectURL(href);
    }
  };

  if (!url) return null;

  const pdfSrc = isPDF
    ? url.includes("#")
      ? `${url}&toolbar=0&navpanes=0&view=FitH`
      : `${url}#toolbar=0&navpanes=0&view=FitH`
    : url;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="w-[calc(100vw-2rem)]! max-w-6xl! h-[82dvh] rounded-xl p-0 gap-0 overflow-hidden flex flex-col sm:h-[84dvh]"
      >
        <VisuallyHidden.Root>
          <DialogTitle>File Preview: {fileName}</DialogTitle>
        </VisuallyHidden.Root>

        {/* Header Toolbar */}
        <div className="flex items-center justify-between px-3 py-2 sm:px-4 sm:py-3 border-b bg-muted/30 z-10 shrink-0">
          <div className="flex items-center gap-2 sm:gap-3 overflow-hidden">
            <div className="shrink-0 p-1.5 sm:p-2 bg-background rounded-md border">
              {getFileIcon()}
            </div>
            <div className="flex flex-col overflow-hidden">
              <span
                className="font-semibold text-xs sm:text-sm truncate"
                title={fileName}
              >
                {fileName}
              </span>
              <span className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider">
                {fileType.split("/")[1] || "FILE"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="hidden sm:flex"
              onClick={() => window.open(url, "_blank")}
              title="Open in new tab"
              aria-label="Open in new tab"
            >
              <ExternalLink className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => downloadFile(url, fileName)}
              title="Download"
              aria-label="Download"
            >
              <Download className="size-4" />
            </Button>
          </div>
        </div>

        {/* Content Area */}
        <div
          className={cn(
            "flex-1 relative w-full h-full overflow-hidden bg-dot-pattern",
            isPDF ? "bg-muted" : "bg-muted/50",
          )}
        >
          {loading && canPreview && !previewFailed && (
            <div
              role="status"
              className="absolute inset-0 flex flex-col items-center justify-center bg-background/50 z-20 backdrop-blur-sm"
            >
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="mt-2 text-sm text-muted-foreground animate-pulse">
                Loading preview...
              </p>
            </div>
          )}

          {isPDF && !previewFailed ? (
            <iframe
              src={pdfSrc}
              className="w-full h-full border-0"
              onLoad={() => setLoading(false)}
              onError={() => {
                setLoading(false);
                setPreviewFailed(true);
              }}
              title={`Preview of ${fileName}`}
            />
          ) : isImage && !previewFailed ? (
            <div className="relative mx-auto flex h-full w-full max-w-5xl items-center justify-center p-3 sm:p-6">
              <Image
                src={url}
                alt={fileName}
                fill
                className="object-contain"
                onLoad={() => setLoading(false)}
                onError={() => {
                  setLoading(false);
                  setPreviewFailed(true);
                }}
                quality={85}
              />
            </div>
          ) : (
            <div
              role={previewFailed ? "alert" : undefined}
              className="flex flex-col items-center justify-center h-full p-6 sm:p-8 text-center"
            >
              <div className="size-20 sm:size-24 rounded-2xl bg-muted flex items-center justify-center mb-4 sm:mb-6 ring-1 ring-border">
                <FileText className="h-10 w-10 sm:h-12 sm:w-12 text-muted-foreground/50" />
              </div>
              <h3 className="text-base sm:text-lg font-medium">
                {previewFailed
                  ? "Preview could not load"
                  : "Preview not available"}
              </h3>
              <p className="text-xs sm:text-sm text-muted-foreground mt-2 max-w-xs mx-auto mb-6 sm:mb-8">
                {previewFailed
                  ? "Try downloading the file or opening it in a new tab."
                  : "This file type cannot be previewed directly in the browser."}
              </p>
              <Button onClick={() => downloadFile(url, fileName)} size="lg">
                <Download className="size-4 mr-2" />
                Download File
              </Button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 px-3 py-2 sm:px-4 sm:py-3 border-t bg-muted/20 shrink-0">
          {downloadFailed && (
            <p role="alert" className="mr-auto text-sm text-destructive">
              Download failed. Try again or open the file in a new tab.
            </p>
          )}
          <DialogClose render={<Button type="button">Close</Button>} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
