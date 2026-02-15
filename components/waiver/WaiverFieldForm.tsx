"use client";

import { WaiverDefinitionField } from "@/types/waiver-definitions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

interface WaiverFieldFormProps {
  fields: WaiverDefinitionField[];
  values: Record<string, string | boolean | number>;
  onChange: (fieldKey: string, value: string | boolean | number) => void;
  signerRoleKey?: string;
  className?: string;
  showErrors?: boolean;
}

export function WaiverFieldForm({
  fields,
  values,
  onChange,
  signerRoleKey,
  className,
  showErrors = false
}: WaiverFieldFormProps) {
  // Filter fields for current signer and exclude signature fields (handled separately)
  const relevantFields = fields.filter(f => 
    (!signerRoleKey || f.signer_role_key === signerRoleKey) && 
    f.field_type !== 'signature'
  ).sort((a, b) => {
      // Sort by page_index then y coordinate approx?
      if (a.page_index !== b.page_index) return a.page_index - b.page_index;
      return a.rect.y - b.rect.y;
  });

  if (relevantFields.length === 0) {
     return <div className="text-muted-foreground italic text-sm p-4 text-center">No additional fields required for this signer.</div>;
  }

  return (
    <div className={cn("space-y-6", className)}>
      {relevantFields.map((field) => (
        <FieldRenderer 
          key={field.id} 
          field={field} 
          value={values[field.field_key]} 
          onChange={(val) => onChange(field.field_key, val)}
          showError={showErrors && field.required && (values[field.field_key] === undefined || values[field.field_key] === "")}
        />
      ))}
    </div>
  );
}

function FieldRenderer({ 
  field, 
  value, 
  onChange,
  showError
}: { 
  field: WaiverDefinitionField, 
  value: string | boolean | number | undefined, 
  onChange: (val: string | boolean | number) => void,
  showError: boolean
}) {
  const isRequired = field.required;
  const labelText = field.label || field.field_key;
  
  // Safe helpers for value types
  const stringVal = (typeof value === 'string') ? value : '';
  const boolVal = (typeof value === 'boolean') ? value : false;

  return (
    <div className="space-y-2">
      <Label className={cn(showError && "text-destructive")}>
        {labelText} {isRequired && <span className="text-destructive">*</span>}
      </Label>
      
      {field.field_type === 'text' && (
        <Input 
            value={stringVal}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.meta?.placeholder as string || ""}
            className={cn(showError && "border-destructive focus-visible:ring-destructive")}
        />
      )}

      {field.field_type === 'date' && (
        <Input 
            type="date"
            value={stringVal}
            onChange={(e) => onChange(e.target.value)}
            min={field.meta?.minDate as string}
            max={field.meta?.maxDate as string}
            className={cn(showError && "border-destructive focus-visible:ring-destructive")}
        />
      )}

      {field.field_type === 'checkbox' && (
        <div className="flex items-center space-x-2">
            <Checkbox 
                id={`field-${field.id}`} 
                checked={boolVal}
                onCheckedChange={(checked) => onChange(checked as boolean)}
                className={cn(showError && "border-destructive")}
            />
            <label 
                htmlFor={`field-${field.id}`} 
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
                {field.meta?.checkboxLabel as string || "Confirm"}
            </label>
        </div>
      )}

      {field.field_type === 'dropdown' && (
        <Select 
            value={stringVal} 
            onValueChange={(val) => val && onChange(val)}
        >
            <SelectTrigger className={cn(showError && "border-destructive ring-destructive")}>
                <SelectValue placeholder="Select an option" />
            </SelectTrigger>
            <SelectContent>
                {(field.meta?.options as string[] || []).map((opt) => (
                    <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                ))}
            </SelectContent>
        </Select>
      )}

      {field.field_type === 'radio' && (
        <RadioGroup value={stringVal} onValueChange={onChange}>
             {(field.meta?.options as string[] || []).map((opt) => (
                <div className="flex items-center space-x-2" key={opt}>
                    <RadioGroupItem value={opt} id={`field-${field.id}-${opt}`} />
                    <Label htmlFor={`field-${field.id}-${opt}`}>{opt}</Label>
                </div>
             ))}
        </RadioGroup>
      )}

      {showError && (
        <p className="text-[0.8rem] font-medium text-destructive">
            This field is required.
        </p>
      )}
    </div>
  );
}
