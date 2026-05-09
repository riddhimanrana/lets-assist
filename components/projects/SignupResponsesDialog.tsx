"use client";

import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { FormSchema } from "@/lib/forms/engine";

interface SignupResponsesDialogProps {
  isOpen: boolean;
  onClose: () => void;
  responseData: Record<string, any> | null;
  formSchema: FormSchema | null;
  participantName: string;
}

export function SignupResponsesDialog({
  isOpen,
  onClose,
  responseData,
  formSchema,
  participantName,
}: SignupResponsesDialogProps) {
  if (!responseData) return null;

  // If no schema, just show raw keys/values
  const renderRawData = () => (
    <div className="space-y-4">
      {Object.entries(responseData).map(([key, value]) => (
        <div key={key} className="border-b pb-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase">{key.replace(/_/g, ' ')}</p>
          <p className="text-sm">{String(value)}</p>
        </div>
      ))}
    </div>
  );

  // If we have a schema, map keys to labels
  const renderMappedData = () => {
    if (!formSchema) return renderRawData();

    const allFields = formSchema.sections.flatMap(s => s.fields);
    
    return (
      <div className="space-y-6">
        {formSchema.sections.map((section, sIdx) => (
          <div key={sIdx} className="space-y-4">
            <h3 className="text-sm font-bold border-b pb-1 text-primary">{section.title}</h3>
            <div className="grid gap-4">
              {section.fields.map((field) => {
                const value = responseData[field.key];
                if (value === undefined || value === null) return null;

                return (
                  <div key={field.key} className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">{field.label}</p>
                    <div className="text-sm bg-muted/30 p-2 rounded-md">
                      {field.type === 'checkbox' ? (
                        <Badge variant={value ? "default" : "outline"}>
                          {value ? "Yes" : "No"}
                        </Badge>
                      ) : (
                        String(value)
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col p-0">
        <DialogHeader className="p-6 pb-2">
          <DialogTitle>Form Responses: {participantName}</DialogTitle>
          <DialogDescription>
            Custom registration data collected during signup.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="flex-1 p-6 pt-2">
          {renderMappedData()}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
