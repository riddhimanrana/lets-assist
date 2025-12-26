import { z } from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { DialogFooter } from "@/components/ui/dialog";
import { useState } from "react"; // Import useState

// Constants for phone validation
const PHONE_LENGTH = 10; // For raw digits
const PHONE_REGEX = /^\d{3}-\d{3}-\d{4}$/; // Format XXX-XXX-XXXX

const formSchema = z.object({
  name: z.string().min(2, { message: "Name is required" }),
  email: z.string().email({ message: "Invalid email address" }),
  phone: z.preprocess(
    // Allow empty string or undefined initially
    (val) => (typeof val === "string" && val.trim() === "" ? undefined : val),
    z.string()
      .refine(
        // Validate against the XXX-XXX-XXXX format if a value exists
        (val) => !val || PHONE_REGEX.test(val),
        "Phone number must be in format XXX-XXX-XXXX"
      )
      .transform((val) => {
        // Store only digits if validation passes
        if (!val) return undefined;
        return val.replace(/\D/g, ""); // Remove non-digit characters
      })
      .refine(
        // Ensure exactly 10 digits if a value exists
        (val) => !val || val.length === PHONE_LENGTH,
        `Phone number must contain exactly ${PHONE_LENGTH} digits.`
      )
      .optional() // Make the entire refined/transformed field optional
  ),
});

type FormValues = z.infer<typeof formSchema>;

interface ProjectFormProps {
  onSubmit: (data: FormValues) => void;
  onCancel: () => void;
  isSubmitting?: boolean;
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


export function ProjectSignupForm({ onSubmit, onCancel, isSubmitting }: ProjectFormProps) {
  const [phoneNumberLength, setPhoneNumberLength] = useState(0); // State for phone number length
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "", // Initialize as empty string for the input field
    },
  });

  // Function to handle form submission, ensuring phone is transformed correctly
  const handleFormSubmit = (data: FormValues) => {
    // The data passed to onSubmit will already have the phone number transformed (digits only or undefined)
    // due to the zod schema's transform function.
    onSubmit(data);
  };


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
        
        <DialogFooter>
          <Button 
            type="submit"
            disabled={isSubmitting}
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