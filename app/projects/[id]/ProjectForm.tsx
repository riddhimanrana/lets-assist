import { z } from "zod";
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError as FormMessage,
} from "@/components/ui/field";
import { Controller } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { DialogFooter } from "@/components/ui/dialog";
import { useState } from "react"; // Import useState
import type { WaiverSignatureInput, WaiverTemplate, WaiverDefinitionFull } from "@/types";
import { WaiverSigningDialog } from '@/components/waiver/WaiverSigningDialog';
import { PenTool, Check } from 'lucide-react';

// Constants for phone validation
const PHONE_LENGTH = 10; // For raw digits
const PHONE_REGEX = /^\d{3}-\d{3}-\d{4}$/; // Format XXX-XXX-XXXX

const formSchema = z.object({
  name: z.string().min(2, { message: "Name is required" }),
  email: z.string().email({ message: "Invalid email address" }),
  phone: z
    .string()
    .refine(
      // Validate against the XXX-XXX-XXXX format if a value exists
      (val) => !val || val === "" || PHONE_REGEX.test(val),
      "Phone number must be in format XXX-XXX-XXXX"
    )
    .transform((val) => {
      // Store only digits if validation passes
      if (!val || val === "") return undefined;
      return val.replace(/\D/g, ""); // Remove non-digit characters
    })
    .refine(
      // Ensure exactly 10 digits if a value exists
      (val) => !val || val.length === PHONE_LENGTH,
      `Phone number must contain exactly ${PHONE_LENGTH} digits.`
    )
    .optional() // Make the entire refined/transformed field optional
    .or(z.literal("").transform(() => undefined)),
  comment: z
    .string()
    .max(100, { message: "Comment must be 100 characters or less" })
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

type FormValues = z.infer<typeof formSchema>;

interface ProjectFormProps {
  onSubmit: (data: FormValues, waiverSignature?: WaiverSignatureInput | null) => void;
  onCancel: () => void;
  isSubmitting?: boolean;
  showCommentField?: boolean;
  waiverRequired?: boolean;
  waiverAllowUpload?: boolean;
  waiverTemplate?: WaiverTemplate | null;
  waiverPdfUrl?: string | null;
  waiverDefinition?: WaiverDefinitionFull | null;
}

// Helper function to format phone number input
const formatPhoneNumber = (value: string): string => {
  if (!value) return value;
  const phoneNumber = value.replace(/[^\d]/g, ""); // Allow only digits
  const phoneNumberLength = phoneNumber.length;

  if (phoneNumberLength < 4) return phoneNumber;
  if (phoneNumberLength < 7) {
    return `${phoneNumber.slice(0, 3)}-${phoneNumber.slice(3)}`;
  }
  return `${phoneNumber.slice(0, 3)}-${phoneNumber.slice(3, 6)}-${phoneNumber.slice(6, 10)}`;
};


export function ProjectSignupForm({
  onSubmit,
  onCancel: _onCancel,
  isSubmitting,
  showCommentField = false,
  waiverRequired = false,
  waiverAllowUpload = true,
  waiverTemplate = null,
  waiverPdfUrl = null,
  waiverDefinition = null,
}: ProjectFormProps) {
  // Mobile check for responsive layout if needed
  // Using simple responsive classes instead of hook
  const [phoneNumberLength, setPhoneNumberLength] = useState(0); // State for phone number length
  const [waiverSignature, setWaiverSignature] = useState<WaiverSignatureInput | null>(null);
  const [isWaiverDialogOpen, setIsWaiverDialogOpen] = useState(false);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "", // Initialize as empty string for the input field
      comment: "",
    },
  });

  // Function to handle form submission, ensuring phone is transformed correctly
  const handleFormSubmit = (data: FormValues) => {
    // The data passed to onSubmit will already have the phone number transformed (digits only or undefined)
    // due to the zod schema's transform function.
    onSubmit(data, waiverSignature);
  };

  const signerName = form.watch("name");
  const signerEmail = form.watch("email");
  const waiverSatisfied = !waiverRequired || !!waiverSignature;

  const handleWaiverComplete = async (input: WaiverSignatureInput) => {
    setWaiverSignature(input);
    setIsWaiverDialogOpen(false);
  };


  return (
    <form onSubmit={form.handleSubmit(handleFormSubmit)} className="space-y-4">
      <Controller
        control={form.control}
        name="name"
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={field.name}>Full Name</FieldLabel>
            <Input id={field.name} placeholder="Enter your name" {...field} aria-invalid={fieldState.invalid} />
            {fieldState.invalid && <FormMessage errors={[fieldState.error]} />}
          </Field>
        )}
      />

      <Controller
        control={form.control}
        name="email"
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={field.name}>Email</FieldLabel>
            <Input id={field.name} placeholder="your@email.com" {...field} aria-invalid={fieldState.invalid} />
            {fieldState.invalid && <FormMessage errors={[fieldState.error]} />}
          </Field>
        )}
      />

      <Controller
        control={form.control}
        name="phone"
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <div className="flex justify-between items-center">
              <FieldLabel htmlFor={field.name}>Phone Number (Optional)</FieldLabel>
              {/* Display character count */}
              <span
                className={`text-xs ${phoneNumberLength > PHONE_LENGTH ? "text-destructive font-semibold" : "text-muted-foreground"}`}
              >
                {phoneNumberLength}/{PHONE_LENGTH}
              </span>
            </div>
            <Input
              id={field.name}
              type="tel" // Use tel type for better mobile UX
              placeholder="555-555-5555"
              {...field}
              value={field.value || ""} // Ensure value is controlled, default to empty string if undefined/null
              onChange={(e) => {
                const formatted = formatPhoneNumber(e.target.value);
                field.onChange(formatted); // Update form with formatted value
                // Update length count based on digits only
                setPhoneNumberLength(formatted.replace(/-/g, "").length);
              }}
              maxLength={12} // Max length for XXX-XXX-XXXX format
              aria-invalid={fieldState.invalid}
            />
            {/* Add FormDescription */}
            {fieldState.invalid && <FormMessage errors={[fieldState.error]} />}
          </Field>
        )}
      />

      {showCommentField && (
        <Controller
          control={form.control}
          name="comment"
          render={({ field, fieldState }) => {
            const commentLength = ((field.value as string) || "").length;
            return (
              <Field data-invalid={fieldState.invalid}>
                <div className="flex justify-between items-center">
                  <FieldLabel htmlFor={field.name}>Comment (Optional)</FieldLabel>
                  <span className={`text-xs ${commentLength > 100 ? "text-destructive" : "text-muted-foreground"}`}>
                    {commentLength}/100
                  </span>
                </div>
                <Textarea
                  id={field.name}
                  placeholder="Add a note for the organizer..."
                  {...field}
                  value={(field.value as string) || ""}
                  rows={2}
                  maxLength={100}
                  className="resize-none text-sm"
                  aria-invalid={fieldState.invalid}
                />
                <FieldDescription className="text-xs">
                  Brief note visible to the organizer.
                </FieldDescription>
                {fieldState.invalid && <FormMessage errors={[fieldState.error]} />}
              </Field>
            );
          }}
        />
      )}

      {waiverRequired && (
        <div className="space-y-2 border rounded-md p-4 bg-secondary/10">
          <FieldLabel>Waiver Agreement</FieldLabel>
          <div className="text-sm text-muted-foreground mb-4">
            A signature is required to participate in this event.
          </div>
          
          {!waiverSignature ? (
             <Button 
               type="button" 
               onClick={() => setIsWaiverDialogOpen(true)}
               variant="outline"
               className="w-full sm:w-auto"
             >
               <PenTool className="h-4 w-4 mr-2" />
               Sign Waiver
             </Button>
          ) : (
             <div className="flex items-center justify-between p-3 bg-green-50/50 border border-green-200 rounded-lg">
                <div className="flex items-center gap-2">
                   <div className="h-8 w-8 rounded-full bg-green-100 flex items-center justify-center text-green-600">
                      <Check className="h-4 w-4" />
                   </div>
                   <div className="text-sm font-medium text-green-700">
                      Signature Captured
                   </div>
                </div>
                <Button 
                   type="button" 
                   variant="ghost" 
                   size="sm"
                   onClick={() => setIsWaiverDialogOpen(true)}
                   className="text-muted-foreground hover:text-text"
                >
                   Review
                </Button>
             </div>
          )}

          <WaiverSigningDialog
            isOpen={isWaiverDialogOpen}
            onClose={() => setIsWaiverDialogOpen(false)}
            waiverDefinition={waiverDefinition}
            waiverPdfUrl={waiverPdfUrl}
            waiverTemplate={waiverTemplate}
            onComplete={handleWaiverComplete}
            defaultSignerName={signerName}
            defaultSignerEmail={signerEmail}
          />
        </div>
      )}

      <DialogFooter>
        <Button
          type="submit"
          disabled={isSubmitting || !waiverSatisfied}
        >
          {isSubmitting && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          Sign Up
        </Button>
      </DialogFooter>
    </form>
  );
}