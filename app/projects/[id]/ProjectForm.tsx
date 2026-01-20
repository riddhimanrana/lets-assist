import { z } from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription, // Import FormDescription
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { DialogFooter } from "@/components/ui/dialog";
import { useState } from "react"; // Import useState
import { WaiverSignatureSection } from "@/app/projects/_components/WaiverSignatureSection";
import type { WaiverSignatureInput, WaiverTemplate } from "@/types";

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
  onCancel,
  isSubmitting,
  showCommentField = false,
  waiverRequired = false,
  waiverAllowUpload = true,
  waiverTemplate = null,
  waiverPdfUrl = null,
}: ProjectFormProps) {
  const [phoneNumberLength, setPhoneNumberLength] = useState(0); // State for phone number length
  const [waiverSignature, setWaiverSignature] = useState<WaiverSignatureInput | null>(null);
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


  return (
    <Form {...form}>
      {/* Pass the modified handler to form.handleSubmit */}
      <form onSubmit={form.handleSubmit(handleFormSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Full Name</FormLabel>
              <FormControl>
                <Input placeholder="Enter your name" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input placeholder="your@email.com" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <div className="flex justify-between items-center">
                 <FormLabel>Phone Number (Optional)</FormLabel>
                 {/* Display character count */}
                 <span
                   className={`text-xs ${phoneNumberLength > PHONE_LENGTH ? "text-destructive font-semibold" : "text-muted-foreground"}`}
                 >
                   {phoneNumberLength}/{PHONE_LENGTH}
                 </span>
              </div>
              <FormControl>
                <Input
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
                />
              </FormControl>
              {/* Add FormDescription */}
              <FormMessage />
            </FormItem>
          )}
        />

        {showCommentField && (
          <FormField
            control={form.control}
            name="comment"
            render={({ field }) => {
              const commentLength = ((field.value as string) || "").length;
              return (
                <FormItem>
                  <div className="flex justify-between items-center">
                    <FormLabel>Comment (Optional)</FormLabel>
                    <span className={`text-xs ${commentLength > 100 ? "text-destructive" : "text-muted-foreground"}`}>
                      {commentLength}/100
                    </span>
                  </div>
                  <FormControl>
                    <Textarea
                      placeholder="Add a note for the organizer..."
                      {...field}
                      value={(field.value as string) || ""}
                      rows={2}
                      maxLength={100}
                      className="resize-none text-sm"
                    />
                  </FormControl>
                  <FormDescription className="text-xs">
                    Brief note visible to the organizer.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              );
            }}
          />
        )}

        {waiverRequired && (
          <WaiverSignatureSection
            template={waiverTemplate}
            waiverPdfUrl={waiverPdfUrl}
            signerName={signerName}
            signerEmail={signerEmail}
            allowUpload={waiverAllowUpload}
            required
            onChange={setWaiverSignature}
          />
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
    </Form>
  );
}