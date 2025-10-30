"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ChevronDownIcon } from "lucide-react";
import { submitDOBOnboarding } from "./actions";
import { toast } from "sonner";

interface DOBOnboardingFormProps {
  userId: string;
}

export default function DOBOnboardingForm({ userId }: DOBOnboardingFormProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState<Date>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!date) {
      toast.error("Please select your date of birth");
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await submitDOBOnboarding(userId, date.toISOString());

      if (result.error) {
        toast.error(result.error);
        setIsSubmitting(false);
        return;
      }

      if (result.requiresParentalConsent) {
        toast.info("Parental consent required", {
          description: "You will be redirected to request parental consent.",
        });
        router.push("/account/parental-consent");
      } else {
        toast.success("Profile updated successfully!");
        router.push("/home");
      }
    } catch (error) {
      toast.error("Something went wrong. Please try again.");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Label htmlFor="date" className="text-sm font-medium">
          Date of Birth
        </Label>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              id="date"
              className="w-full justify-between font-normal"
              disabled={isSubmitting}
            >
              {date ? date.toLocaleDateString() : "Select your date of birth"}
              <ChevronDownIcon className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto overflow-hidden p-0" align="start">
            <Calendar
              mode="single"
              selected={date}
              captionLayout="dropdown"
              onSelect={(selectedDate) => {
                setDate(selectedDate);
                setOpen(false);
              }}
              disabled={(date) =>
                date > new Date() || date < new Date("1900-01-01")
              }
              defaultMonth={new Date(2010, 0)}
              fromYear={1900}
              toYear={new Date().getFullYear()}
            />
          </PopoverContent>
        </Popover>
        <p className="text-xs text-muted-foreground">
          This helps us provide age-appropriate content and features.
        </p>
      </div>

      <Button
        onClick={handleSubmit}
        disabled={!date || isSubmitting}
        className="w-full"
        size="lg"
      >
        {isSubmitting ? "Saving..." : "Continue"}
      </Button>

      <div className="text-xs text-center text-muted-foreground space-y-1">
        <p>⚠️ You must complete this step to access your account.</p>
        <p>Your date of birth is required for COPPA compliance.</p>
      </div>
    </div>
  );
}
