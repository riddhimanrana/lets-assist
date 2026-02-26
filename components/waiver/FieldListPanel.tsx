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
  fieldType: string; // PDF field type
  pageIndex: number;
  rect: { x: number; y: number; width: number; height: number };
  pdfFieldName?: string;
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

  // Computed stats for display
  const mappedSignaturesCount = signatureFields.filter(f => fieldMappings[f.fieldName]?.signerRoleKey).length;
  const unassignedSignaturesCount = signatureFields.length - mappedSignaturesCount;
  const requiredFieldsCount = detectedFields.filter(f => fieldMappings[f.fieldName]?.required ?? f.required).length;

  const getFieldMapping = (field: DetectedPdfField): FieldMapping => {
    return fieldMappings[field.fieldName] || {
      fieldKey: field.fieldName,
      required: field.required || false,
      signerRoleKey: undefined,
      fieldType: field.fieldType,
      pageIndex: field.pageIndex,
      rect: field.rect,
      pdfFieldName: field.fieldName
    };
  };

  const updateMapping = (field: DetectedPdfField, updates: Partial<FieldMapping>) => {
    const current = getFieldMapping(field);
    onFieldMappingChange(field.fieldName, { ...current, ...updates });
  };

  const getSignerLabel = (roleKey: string | undefined) => {
    if (!roleKey || roleKey === 'unassigned') return 'Unassigned (Optional)';
    const signer = signers.find(s => s.roleKey === roleKey);
    return signer?.label || roleKey;
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
        role="button"
        tabIndex={0}
        onClick={() => onFieldClick(field)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onFieldClick(field);
          }
        }}
      >
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            {getIcon(field.fieldType)}
            <span className="font-medium text-sm truncate max-w-36" title={field.fieldName}>
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
                  <SelectValue placeholder="Assign Role">
                    {getSignerLabel(mapping.signerRoleKey)}
                  </SelectValue>
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
            <span className="text-success flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" /> Configured
            </span>
          ) : (
            <span className="text-warning flex items-center gap-1">
              <AlertCircle className="h-3 w-3" /> Needs assignment
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top Stats Bar */}
      <div className="shrink-0 flex items-center gap-2 mb-3 px-1 overflow-x-auto pb-2 scrollbar-none">
        <Badge variant={unassignedSignaturesCount > 0 ? "destructive" : "secondary"} className="text-[10px] whitespace-nowrap h-5">
           {mappedSignaturesCount}/{signatureFields.length} Signatures Mapped
        </Badge>
        <Badge variant="outline" className="text-[10px] whitespace-nowrap h-5">
           {requiredFieldsCount} Required Fields
        </Badge>
        {unassignedSignaturesCount > 0 && (
          <Badge variant="outline" className="text-[10px] whitespace-nowrap h-5 text-warning border-warning/40 bg-warning/10">
             {unassignedSignaturesCount} Unassigned
          </Badge>
        )}
      </div>

      {/* Inline Warning Callout */}
      {unassignedSignaturesCount > 0 && (
        <div className="shrink-0 mb-3 mx-1 p-2 bg-warning/10 border border-warning/40 rounded text-xs text-warning flex items-start gap-2">
           <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
           <span>
             There are {unassignedSignaturesCount} signature fields not assigned to any role. 
             Signers might not see where to sign.
           </span>
        </div>
      )}

      <ScrollArea className="flex-1 pr-4">
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
                 No signature fields detected. Use the custom placements section below to add signature boxes.
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
    </div>
  );
}
