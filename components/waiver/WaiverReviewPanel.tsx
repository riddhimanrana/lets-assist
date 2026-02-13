"use client";

import { cn } from "@/lib/utils";
import { WaiverDefinitionField } from "@/types/waiver-definitions";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

interface WaiverReviewPanelProps {
  pdfUrl: string;
  signatureFields?: WaiverDefinitionField[];
  onReviewComplete?: (completed: boolean) => void;
  reviewed: boolean;
  className?: string;
}

export function WaiverReviewPanel({
  pdfUrl,
  onReviewComplete,
  reviewed,
  className,
}: WaiverReviewPanelProps) {
  return (
    <div className={cn("flex flex-col h-full", className)}>
      <div className="flex-1 rounded-lg border bg-background overflow-hidden min-h-[400px] relative">
        <iframe
          src={`${pdfUrl}#toolbar=0&navpanes=0`}
          className="w-full h-full absolute inset-0"
          title="Waiver PDF"
        />
        {/* Note: PDF field highlighting is not supported with iframe rendering. 
            To support highlighting, we would need to switch to pdf.js canvas rendering 
            which is significantly more complex and requires handling PDF coordinates 
            transformation to screen coordinates. */}
      </div>
      
      <div className="mt-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-lg bg-muted/30 border">
         <div className="flex items-start gap-2">
            <Checkbox 
                id="waiver-reviewed" 
                checked={reviewed}
                onCheckedChange={(c) => onReviewComplete?.(c === true)}
            />
            <Label htmlFor="waiver-reviewed" className="text-sm leading-none pt-0.5 cursor-pointer">
                I have reviewed the waiver document above.
            </Label>
         </div>
         
         <Button variant="outline" size="sm" asChild>
            <a href={pdfUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4 mr-2" />
                Open in New Tab
            </a>
         </Button>
      </div>
    </div>
  );
}
