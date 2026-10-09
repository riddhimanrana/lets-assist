"use client";

import React, { useState } from "react";
import { useHydrated } from "@/hooks/useHydrated";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "lucide-react";
import { PlusIcon, useAnimatedIcon } from "@/components/icons/animated";
import { toast } from "sonner";
import { format } from "date-fns";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { TimePicker } from "@/components/ui/time-picker";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface AddVolunteerHoursModalProps {
  onAdd?: (data: UnverifiedHoursData) => void;
  trigger?: React.ReactNode;
}

interface UnverifiedHoursData {
  title: string; // Required self-reported title
  creatorName: string; // Person who supervised / creator reference
  organizationName?: string; // Optional organization name
  date: Date | undefined; // Required date
  startTime: string; // Required start time
  endTime: string; // Required end time
  description?: string; // What they did
}

type FormErrors = Partial<Record<keyof UnverifiedHoursData, string>>;

export function AddVolunteerHoursModal({
  onAdd,
  trigger,
}: AddVolunteerHoursModalProps) {
  const hydrated = useHydrated();
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState<UnverifiedHoursData>({
    title: "",
    creatorName: "",
    organizationName: "",
    date: undefined,
    startTime: "09:00",
    endTime: "17:00",
    description: "",
  });

  const [errors, setErrors] = useState<FormErrors>({});
  const addIcon = useAnimatedIcon();

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};

    // Title required
    if (!formData.title.trim()) {
      newErrors.title = "Title is required";
    }

    // Creator name required
    if (!formData.creatorName.trim()) {
      newErrors.creatorName = "Creator/supervisor name is required";
    }

    // Date is required
    if (!formData.date) {
      newErrors.date = "Date is required";
    }

    // Start time is required
    if (!formData.startTime) {
      newErrors.startTime = "Start time is required";
    }

    // End time is required
    if (!formData.endTime) {
      newErrors.endTime = "End time is required";
    }

    // Validate date range
    if (formData.date) {
      const oneWeekFromNow = new Date();
      oneWeekFromNow.setDate(oneWeekFromNow.getDate() + 7);

      if (formData.date > oneWeekFromNow) {
        newErrors.date = "Date cannot be more than a week in the future";
      }
    }

    // Validate time logic
    if (formData.date && formData.startTime && formData.endTime) {
      const startDateTime = new Date(
        `${format(formData.date, "yyyy-MM-dd")}T${formData.startTime}`,
      );
      const endDateTime = new Date(
        `${format(formData.date, "yyyy-MM-dd")}T${formData.endTime}`,
      );

      if (endDateTime <= startDateTime) {
        newErrors.endTime = "End time must be after start time";
      }

      // Check duration (max 24 hours)
      const durationMs = endDateTime.getTime() - startDateTime.getTime();
      if (durationMs > 24 * 60 * 60 * 1000) {
        newErrors.endTime = "Duration cannot exceed 24 hours";
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const calculateDuration = (): string => {
    if (!formData.date || !formData.startTime || !formData.endTime) return "";

    const startDateTime = new Date(
      `${format(formData.date, "yyyy-MM-dd")}T${formData.startTime}`,
    );
    const endDateTime = new Date(
      `${format(formData.date, "yyyy-MM-dd")}T${formData.endTime}`,
    );

    if (endDateTime <= startDateTime) return "";

    const durationMs = endDateTime.getTime() - startDateTime.getTime();
    const hours = Math.floor(durationMs / (1000 * 60 * 60));
    const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h`;
    return `${minutes}m`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      toast.error("Please fix the errors in the form");
      return;
    }

    setIsLoading(true);

    try {
      const payload = {
        title: formData.title.trim(),
        creatorName: formData.creatorName.trim(),
        organizationName: formData.organizationName?.trim() || null,
        date: formData.date ? format(formData.date, "yyyy-MM-dd") : "",
        startTime: formData.startTime,
        endTime: formData.endTime,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        description: formData.description?.trim() || null,
      };

      const res = await fetch("/api/self-reported-hours", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to add hours");
      }

      if (onAdd) {
        onAdd(formData); // optional external hook
      }

      // Trigger a soft refresh so new hours appear
      try {
        // Prefer router.refresh but to avoid importing, fallback to location.reload if needed
        if (typeof window !== "undefined" && window.location) {
          // Use partial reload by calling a revalidation endpoint in future; for now simple reload
          window.location.reload();
        }
      } catch {
        // Ignore refresh errors in non-browser environments
      }

      toast.success("Self-reported hours added", {
        description: `${payload.title} • ${calculateDuration() || "Time recorded"}`,
      });

      // Reset form
      setFormData({
        title: "",
        creatorName: "",
        organizationName: "",
        date: undefined,
        startTime: "09:00",
        endTime: "17:00",
        description: "",
      });
      setErrors({});
      setIsOpen(false);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Please try again or contact support if the problem persists.";
      toast.error("Failed to add volunteer hours", {
        description: message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const defaultTrigger = (
    <Button {...addIcon.triggerProps}>
      <PlusIcon
        ref={addIcon.ref}
        size={16}
        data-icon="inline-start"
        aria-hidden="true"
      />
      Add self-reported hours
    </Button>
  );

  const duration = calculateDuration();

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger
        disabled={!hydrated}
        render={
          (React.isValidElement(trigger)
            ? trigger
            : defaultTrigger) as React.ReactElement
        }
      />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add self-reported hours</DialogTitle>
          <DialogDescription>
            Log volunteer hours performed outside the platform. Provide a clear
            title, supervisor/creator, and optional organization.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="title">Title *</Label>
            <Input
              id="title"
              value={formData.title}
              onChange={(e) =>
                setFormData((p) => ({ ...p, title: e.target.value }))
              }
              placeholder="e.g., Community Cleanup, Tutoring Session"
              className={errors.title ? "border-destructive" : ""}
            />
            {errors.title && (
              <p className="text-sm text-destructive">{errors.title}</p>
            )}
          </div>

          {/* Creator / Supervisor Name */}
          <div className="space-y-2">
            <Label htmlFor="creatorName">Creator / supervisor *</Label>
            <Input
              id="creatorName"
              value={formData.creatorName}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  creatorName: e.target.value,
                }))
              }
              placeholder="e.g., Jane Smith"
              className={errors.creatorName ? "border-destructive" : ""}
            />
            {errors.creatorName && (
              <p className="text-sm text-destructive">{errors.creatorName}</p>
            )}
          </div>

          {/* Organization (Optional) */}
          <div className="space-y-2">
            <Label htmlFor="organizationName">Organization (optional)</Label>
            <Input
              id="organizationName"
              value={formData.organizationName}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  organizationName: e.target.value,
                }))
              }
              placeholder="e.g., Local Food Bank"
            />
          </div>

          {/* Date Selection */}
          <div className="space-y-2">
            <Label>Date *</Label>
            <Popover>
              <PopoverTrigger
                render={
                  <Button
                    variant="outline"
                    className={`w-full justify-start text-left font-normal ${!formData.date ? "text-muted-foreground" : ""} ${errors.date ? "border-destructive" : ""}`}
                  >
                    <Calendar data-icon="inline-start" aria-hidden="true" />
                    {formData.date
                      ? format(formData.date, "PPP")
                      : "Select date"}
                  </Button>
                }
              />
              <PopoverContent className="w-auto p-0" align="start">
                <CalendarComponent
                  mode="single"
                  selected={formData.date}
                  onSelect={(date) =>
                    setFormData((prev) => ({ ...prev, date }))
                  }
                  disabled={(date) => {
                    const oneWeekFromNow = new Date();
                    oneWeekFromNow.setDate(oneWeekFromNow.getDate() + 7);
                    return (
                      date > oneWeekFromNow || date < new Date("1900-01-01")
                    );
                  }}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
            {errors.date && (
              <p className="text-sm text-destructive">{errors.date}</p>
            )}
          </div>

          {/* Time Range */}
          <div className="grid grid-cols-2 gap-4">
            <TimePicker
              value={formData.startTime}
              onChangeAction={(time) =>
                setFormData((prev) => ({ ...prev, startTime: time }))
              }
              label="Start time *"
              error={!!errors.startTime}
              errorMessage={errors.startTime}
            />

            <TimePicker
              value={formData.endTime}
              onChangeAction={(time) =>
                setFormData((prev) => ({ ...prev, endTime: time }))
              }
              label="End time *"
              error={!!errors.endTime}
              errorMessage={errors.endTime}
            />
          </div>

          {/* Duration Display */}
          {duration && (
            <p className="text-muted-foreground text-sm">
              Duration:{" "}
              <span className="text-foreground font-medium">{duration}</span>
            </p>
          )}

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">
              Activity description
              <span className="text-xs text-muted-foreground ml-2">
                (optional)
              </span>
            </Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => {
                const value = e.target.value;
                if (value.length <= 200) {
                  setFormData((prev) => ({ ...prev, description: value }));
                }
              }}
              placeholder="Briefly describe what you did during these volunteer hours..."
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              {formData.description?.length || 0}/200 characters
            </p>
          </div>

          <DialogFooter className="flex flex-col sm:flex-row gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsOpen(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? "Adding..." : "Add hours"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
