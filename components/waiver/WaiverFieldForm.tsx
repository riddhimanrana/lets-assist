"use client";

import { WaiverDefinitionField } from "@/types/waiver-definitions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hasStringValue(value: string | boolean | number | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return false;

  const [year, month, day] = value.split('-').map((v) => Number.parseInt(v, 10));
  return (
    date.getFullYear() === year &&
    date.getMonth() + 1 === month &&
    date.getDate() === day
  );
}

export function formatUsPhoneNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 10);

  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function validateWaiverFieldValue(
  field: Pick<WaiverDefinitionField, 'field_type' | 'required' | 'meta'>,
  value: string | boolean | number | undefined,
): { valid: boolean; message?: string } {
  if (field.field_type === 'checkbox') {
    if (field.required && value !== true) {
      return { valid: false, message: 'This checkbox is required.' };
    }
    return { valid: true };
  }

  const isEmpty = !hasStringValue(value);
  if (isEmpty) {
    return field.required
      ? { valid: false, message: 'This field is required.' }
      : { valid: true };
  }

  const stringValue = value.trim();

  switch (field.field_type) {
    case 'email':
      return EMAIL_REGEX.test(stringValue)
        ? { valid: true }
        : { valid: false, message: 'Please enter a valid email address.' };

    case 'phone': {
      const digits = stringValue.replace(/\D/g, '');
      return digits.length === 10
        ? { valid: true }
        : { valid: false, message: 'Phone number must be exactly 10 digits.' };
    }

    case 'date': {
      if (!isValidIsoDate(stringValue)) {
        return { valid: false, message: 'Please pick a valid date.' };
      }

      const minDate = typeof field.meta?.minDate === 'string' ? field.meta.minDate : undefined;
      const maxDate = typeof field.meta?.maxDate === 'string' ? field.meta.maxDate : undefined;

      if (minDate && stringValue < minDate) {
        return { valid: false, message: `Date must be on or after ${minDate}.` };
      }

      if (maxDate && stringValue > maxDate) {
        return { valid: false, message: `Date must be on or before ${maxDate}.` };
      }

      return { valid: true };
    }

    case 'dropdown': {
      const options = Array.isArray(field.meta?.options) ? field.meta.options : [];
      if (options.length > 0 && !options.includes(stringValue)) {
        return { valid: false, message: 'Please select a valid option.' };
      }
      return { valid: true };
    }

    case 'radio': {
      const options = Array.isArray(field.meta?.options) ? field.meta.options : [];
      if (options.length > 0 && !options.includes(stringValue)) {
        return { valid: false, message: 'Please select a valid option.' };
      }
      return { valid: true };
    }

    default:
      return { valid: true };
  }
}

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
  const validation = validateWaiverFieldValue(field, value);
  const hasUserInput = (typeof value === 'boolean') ? value === true : hasStringValue(value);
  const shouldShowValidationError = showError || (hasUserInput && !validation.valid);
  const validationMessage = validation.message || 'This field is required.';

  return (
    <div className="space-y-2">
      <Label className={cn(shouldShowValidationError && "text-destructive")}>
        {labelText} {isRequired && <span className="text-destructive">*</span>}
      </Label>
      
      {(field.field_type === 'text' || field.field_type === 'name') && (
        <Input 
            value={stringVal}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.meta?.placeholder as string || (field.field_type === 'name' ? 'Full name' : '')}
            className={cn(shouldShowValidationError && "border-destructive focus-visible:ring-destructive")}
            data-testid={`waiver-field-input-${field.field_key}`}
        />
      )}

      {field.field_type === 'email' && (
        <Input
            type="email"
            inputMode="email"
            value={stringVal}
            onChange={(e) => onChange(e.target.value.trim())}
            placeholder={field.meta?.placeholder as string || 'name@example.com'}
            className={cn(shouldShowValidationError && "border-destructive focus-visible:ring-destructive")}
            data-testid={`waiver-field-input-${field.field_key}`}
        />
      )}

      {field.field_type === 'phone' && (
        <Input
            type="tel"
            inputMode="numeric"
            value={stringVal}
            onChange={(e) => onChange(formatUsPhoneNumber(e.target.value))}
            placeholder={field.meta?.placeholder as string || '123-456-7890'}
            className={cn(shouldShowValidationError && "border-destructive focus-visible:ring-destructive")}
            data-testid={`waiver-field-input-${field.field_key}`}
        />
      )}

      {field.field_type === 'date' && (
        <DatePicker
            value={stringVal}
            onChange={onChange}
            minDate={field.meta?.minDate as string}
            maxDate={field.meta?.maxDate as string}
            placeholder="Pick a date"
            error={shouldShowValidationError}
            className="w-full"
            data-testid={`waiver-field-input-${field.field_key}`}
        />
      )}

      {field.field_type === 'checkbox' && (
        <div className="flex items-center space-x-2">
            <Checkbox 
                id={`field-${field.id}`} 
                checked={boolVal}
                onCheckedChange={(checked) => onChange(checked === true)}
                className={cn(shouldShowValidationError && "border-destructive")}
              data-testid={`waiver-field-checkbox-${field.field_key}`}
            />
            <Label 
                htmlFor={`field-${field.id}`} 
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
                {field.meta?.checkboxLabel as string || "Confirm"}
            </Label>
        </div>
      )}

      {field.field_type === 'dropdown' && (
        <Select 
            value={stringVal} 
            onValueChange={(val) => val && onChange(val)}
        >
          <SelectTrigger className={cn(shouldShowValidationError && "border-destructive ring-destructive")}>
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

      {!['text', 'name', 'email', 'phone', 'date', 'checkbox', 'dropdown', 'radio'].includes(field.field_type) && (
        <Input
            value={stringVal}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.meta?.placeholder as string || ''}
            className={cn(shouldShowValidationError && "border-destructive focus-visible:ring-destructive")}
            data-testid={`waiver-field-input-${field.field_key}`}
        />
      )}

      {shouldShowValidationError && (
        <p className="text-[0.8rem] font-medium text-destructive">
            {validationMessage}
        </p>
      )}
    </div>
  );
}
