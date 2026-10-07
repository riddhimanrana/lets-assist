"use client";
import { safeConsole } from "@/lib/safe-console";


import { Download, Eye, File, FileImage, FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ProjectDocument } from "@/types";
import { formatBytes } from "@/lib/utils";

const getFileIcon = (type: string) => {
  if (type.includes("pdf")) return <FileText className="size-4" />;
  if (type.includes("image")) return <FileImage className="size-4" />;
  if (type.includes("text")) return <FileText className="size-4" />;
  if (type.includes("word")) return <FileText className="size-4" />;
  return <File className="size-4" />;
};

const downloadFile = async (url: string, filename: string) => {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(href);
  } catch (error) {
    safeConsole.error("Download error:", error);
  }
};

// Check if file is previewable
const isPreviewable = (type: string) => {
  return type.includes("pdf") || type.includes("image");
};

export function ProjectDocumentsCard({
  documents,
  onPreview,
}: {
  documents: ProjectDocument[];
  onPreview: (url: string, fileName: string, fileType: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Project documents</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {documents.map((doc, index) => (
            <li
              key={index}
              className="flex items-center gap-3 py-2 first:pt-0 last:pb-0"
            >
              <span
                className="text-muted-foreground shrink-0"
                aria-hidden="true"
              >
                {getFileIcon(doc.type)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{doc.name}</p>
                <p className="text-muted-foreground text-sm">
                  {formatBytes(doc.size)}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                {isPreviewable(doc.type) && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Preview ${doc.name}`}
                    onClick={() => onPreview(doc.url, doc.name, doc.type)}
                  >
                    <Eye aria-hidden="true" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Download ${doc.name}`}
                  onClick={() => downloadFile(doc.url, doc.name)}
                >
                  <Download aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
