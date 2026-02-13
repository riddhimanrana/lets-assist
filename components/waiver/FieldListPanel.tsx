"use client";

import { DetectedPdfField } from "@/lib/waiver/pdf-field-detect";
import { WaiverDefinitionSignerInput } from "./SignerRolesEditor";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { CheckCircle2, AlertCircle, FileSignature, Type, CheckSquare, MousePointerClick } from "lucide-react";

export interface FieldMapping {
  fieldKey: string;
  signerRoleKey?: string; // For signature fields
  required: boolean;
  label?: string; // Override label
}

interface FieldListPanelProps {
  detectedFields: DetectedPdfField[];
  fieldMappings: Record<string, FieldMapping>;
  signers: WaiverDefinitionSignerInput[];
  onFieldMappingChange: (fieldKey: string, mapping: FieldMapping) => void;
  onFieldClick: (field: DetectedPdfField) => void;
  highlightedField?: DetectedPdfField | null;
}

export function FieldListPanel({
  detectedFields,
  fieldMappings,
  signers,
  onFieldMappingChange,
  onFieldClick,
  highlightedField
}: FieldListPanelProps) {

  // Group fields
  const signatureFields = detectedFields.filter(f => f.fieldType === 'signature');
  const otherFields = detectedFields.filter(f => f.fieldType !== 'signature');

  const getFieldMapping = (field: DetectedPdfField): FieldMapping => {
    return fieldMappings[field.fieldName] || {
      fieldKey: field.fieldName,
      required: field.required || false,
      signerRoleKey: undefined
    };
  };

  const updateMapping = (field: DetectedPdfField, updates: Partial<FieldMapping>) => {
    const current = getFieldMapping(field);
    onFieldMappingChange(field.fieldName, { ...current, ...updates });
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'signature': return <FileSignature className="h-4 w-4" />;
      case 'text': return <Type className="h-4 w-4" />;
      case 'checkbox': return <CheckSquare className="h-4 w-4" />;
      default: return <MousePointerClick className="h-4 w-4" />;
    }
  };

  const renderFieldItem = (field: DetectedPdfField) => {
    const mapping = getFieldMapping(field);
    const isMapped = field.fieldType === 'signature' ? !!mapping.signerRoleKey : true;
    const isHighlighted = highlightedField?.fieldName === field.fieldName;

    return (
      <div 
        key={field.fieldName}
        className={`p-3 border rounded-md mb-2 transition-colors cursor-pointer ${
          isHighlighted ? 'bg-accent border-primary' : 'hover:bg-muted/50'
        }`}
        onClick={() => onFieldClick(field)}
      >
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            {getIcon(field.fieldType)}
            <span className="font-medium text-sm truncate max-w-[150px]" title={field.fieldName}>
              {field.fieldName}
            </span>
          </div>
          <Badge variant="outline" className="text-[10px]">Page {field.pageIndex + 1}</Badge>
        </div>

        <div className="grid gap-2 text-sm">
          {field.fieldType === 'signature' && (
            <div className="space-y-1">
              <Label className="text-xs">Assigned Signer</Label>
              <Select
                value={mapping.signerRoleKey || "unassigned"}
                onValueChange={(val) => updateMapping(field, { signerRoleKey: val === "unassigned" || !val ? undefined : val })}
              >
                <SelectTrigger className="h-8">
                  <SelectValue placeholder="Assign Role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned" className="text-muted-foreground">Unassigned (Optional)</SelectItem>
                   {signers.map(signer => (
                     <SelectItem key={signer.roleKey} value={signer.roleKey}>
                       {signer.label}
                     </SelectItem>
                   ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex items-center justify-between mt-1">
            <Label className="text-xs font-normal text-muted-foreground">Required</Label>
            <Switch
              checked={mapping.required}
              onCheckedChange={(checked) => updateMapping(field, { required: checked })}
              className="scale-75 origin-right"
            />
          </div>
        </div>

        <div className="mt-2 flex items-center gap-1.5 text-xs">
          {isMapped ? (
            <span className="text-green-600 flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" /> Configured
            </span>
          ) : (
            <span className="text-amber-600 flex items-center gap-1">
              <AlertCircle className="h-3 w-3" /> Needs assignment
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <ScrollArea className="h-full pr-4">
      <Accordion defaultValue={["signature-fields", "other-fields"]} className="w-full">
        <AccordionItem value="signature-fields">
          <AccordionTrigger className="sticky top-0 bg-background z-10 py-2">
            <div className="flex items-center gap-2">
              <FileSignature className="h-4 w-4" />
              <span>Signature Fields</span>
              <Badge variant="secondary" className="ml-auto">{signatureFields.length}</Badge>
            </div>
          </AccordionTrigger>
          <AccordionContent className="pt-2">
             {signatureFields.length === 0 ? (
               <div className="text-sm text-muted-foreground p-4 text-center">
                 No signature fields detected. Use the "Validation" tab to check settings.
               </div>
             ) : (
                signatureFields.map(renderFieldItem)
             )}
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="other-fields">
          <AccordionTrigger className="sticky top-0 bg-background z-10 py-2">
             <div className="flex items-center gap-2">
               <Type className="h-4 w-4" />
               <span>Other Fields</span>
               <Badge variant="secondary" className="ml-auto">{otherFields.length}</Badge>
             </div>
          </AccordionTrigger>
          <AccordionContent className="pt-2">
             {otherFields.length === 0 ? (
                <div className="text-sm text-muted-foreground p-4 text-center">
                  No other form fields detected.
                </div>
             ) : (
                 otherFields.map(renderFieldItem)
             )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </ScrollArea>
  );
}
