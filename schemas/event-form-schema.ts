import { z } from "zod";
import { EventType, VerificationMethod } from "@/types";

// Helper to validate time is not in past
const isTimeInPast = (dateStr: string, timeStr: string): boolean => {
  if (!dateStr || !timeStr) return false;
  
  const [hours, minutes] = timeStr.split(':').map(Number);
  const [year, month, day] = dateStr.split('-').map(Number);
  
  const datetime = new Date(year, month - 1, day);
  datetime.setHours(hours, minutes, 0, 0);
  
  return datetime < new Date();
};

// Helper to convert HH:MM time string to minutes since midnight
const timeToMinutes = (timeStr: string): number => {
  if (!timeStr || !timeStr.includes(':')) return -1; // Return invalid value if format is wrong
  const [hours, minutes] = timeStr.split(':').map(Number);
  if (isNaN(hours) || isNaN(minutes)) return -1;
  return hours * 60 + minutes;
};

// Basic Info Schema
export const basicInfoSchema = z.object({
  title: z.string().min(1, "Title is required").max(125, "Title cannot exceed 125 characters"),
  location: z.string().min(1, "Location is required").max(250, "Location cannot exceed 250 characters"),
  locationData: z.any().optional(),
  description: z.string().min(1, "Description is required").max(2000, "Description cannot exceed 2000 characters"),
  organizationId: z.string().nullable(),
});

// One Time Event Schema
export const oneTimeSchema = z.object({
  date: z.string().min(1, "Date is required"),
  startTime: z.string().min(1, "Start time is required"),
  endTime: z.string().min(1, "End time is required"),
  volunteers: z.number().int().min(1, "At least 1 volunteer is required").max(1000, "Maximum 1000 volunteers allowed"),
}).refine(
  (data) => {
    // Compare start and end times
    const [startHour, startMinute] = data.startTime.split(":").map(Number);
    const [endHour, endMinute] = data.endTime.split(":").map(Number);
    
    if (endHour < startHour) return false;
    if (endHour === startHour && endMinute <= startMinute) return false;
    
    return true;
  },
  {
    message: "End time must be after start time",
    path: ["endTime"],
  }
).refine(
  (data) => !isTimeInPast(data.date, data.startTime),
  {
    message: "Start time must be in the future",
    path: ["startTime"],
  }
).refine(
  (data) => !isTimeInPast(data.date, data.endTime),
  {
    message: "End time must be in the future",
    path: ["endTime"],
  }
);

// Slot Schema for Multi Day Events
const slotSchema = z.object({
  startTime: z.string().min(1, "Start time is required"),
  endTime: z.string().min(1, "End time is required"),
  volunteers: z.number().int().min(1, "At least 1 volunteer is required").max(1000, "Maximum 1000 volunteers allowed"),
});

// Day Schema for Multi Day Events
const daySchema = z.object({
  date: z.string().min(1, "Date is required"),
  slots: z.array(slotSchema)
    .min(1, "At least one time slot is required")
    .refine(
      (slots) => {
        // Check each slot has valid times
        return slots.every(slot => {
          const [startHour, startMinute] = slot.startTime.split(":").map(Number);
          const [endHour, endMinute] = slot.endTime.split(":").map(Number);
          
          if (endHour < startHour) return false;
          if (endHour === startHour && endMinute <= startMinute) return false;
          
          return true;
        });
      },
      {
        message: "End time must be after start time for all slots",
        path: [],
      }
    ),
});

// Multi Day Event Schema 
export const multiDaySchema = z.array(daySchema)
  .min(1, "At least one day is required")
  .refine(
    (days) => {
      // Check each day and slot for times in the past
      return days.every(day => 
        day.slots.every(slot => 
          !isTimeInPast(day.date, slot.startTime) && !isTimeInPast(day.date, slot.endTime)
        )
      );
    },
    {
      message: "All dates and times must be in the future",
      path: [],
    }
  );

// Role Schema for Multi Role Events
const roleSchema = z.object({
  name: z.string().min(1, "Role name is required").max(75, "Role name cannot exceed 75 characters"),
  startTime: z.string().min(1, "Start time is required"),
  endTime: z.string().min(1, "End time is required"),
  volunteers: z.number().int().min(1, "At least 1 volunteer is required").max(1000, "Maximum 1000 volunteers allowed"),
});

// Multi Role Event Schema
export const multiRoleSchema = z.object({
  date: z.string().min(1, "Date is required"),
  overallStart: z.string().min(1, "Overall start time is required"),
  overallEnd: z.string().min(1, "Overall end time is required"),
  roles: z.array(roleSchema)
    .min(1, "At least one role is required")
    .refine(
      (roles) => {
        // Check each role has valid times (end > start)
        return roles.every(role => {
          const startMinutes = timeToMinutes(role.startTime);
          const endMinutes = timeToMinutes(role.endTime);
          return startMinutes !== -1 && endMinutes !== -1 && endMinutes > startMinutes;
        });
      },
      {
        message: "End time must be after start time for all roles",
        path: ["roles"],
      }
    )
    .refine( // This is the role name uniqueness validation
      (roles) => {
        const names = roles.map(role => role.name.trim().toLowerCase());
        const uniqueNames = new Set(names);
        return names.length === uniqueNames.size;
      },
      {
        message: "Role names must be unique",
        path: ["roles"],
      }
    ),
}).refine(
  (data) => {
    // Compare overall start and end times
    const startMinutes = timeToMinutes(data.overallStart);
    const endMinutes = timeToMinutes(data.overallEnd);
    return startMinutes !== -1 && endMinutes !== -1 && endMinutes > startMinutes;
  },
  {
    message: "Overall end time must be after overall start time",
    path: ["overallEnd"],
  }
).refine(
  (data) => !isTimeInPast(data.date, data.overallStart),
  {
    message: "Overall start time must be in the future",
    path: ["overallStart"],
  }
).refine(
  (data) => !isTimeInPast(data.date, data.overallEnd),
  {
    message: "Overall end time must be in the future",
    path: ["overallEnd"],
  }
).refine(
  (data) => {
    // Check all role times are in the future
    return data.roles.every(role => 
      !isTimeInPast(data.date, role.startTime) && !isTimeInPast(data.date, role.endTime)
    );
  },
  {
    message: "All role times must be in the future",
    path: ["roles"],
  }
).refine(
  (data) => {
    // Check if overallStart encompasses the earliest role startTime
    if (data.roles.length === 0) return true; // Pass if no roles
    const overallStartMinutes = timeToMinutes(data.overallStart);
    const minRoleStartMinutes = Math.min(...data.roles.map(role => timeToMinutes(role.startTime)));
    return overallStartMinutes !== -1 && minRoleStartMinutes !== -1 && overallStartMinutes <= minRoleStartMinutes;
  },
  {
    message: "Overall start time must be at or before the earliest role start time",
    path: ["overallStart"],
  }
).refine(
  (data) => {
    // Check if overallEnd encompasses the latest role endTime
    if (data.roles.length === 0) return true; // Pass if no roles
    const overallEndMinutes = timeToMinutes(data.overallEnd);
    const maxRoleEndMinutes = Math.max(...data.roles.map(role => timeToMinutes(role.endTime)));
    return overallEndMinutes !== -1 && maxRoleEndMinutes !== -1 && overallEndMinutes >= maxRoleEndMinutes;
  },
  {
    message: "Overall end time must be at or after the latest role end time",
    path: ["overallEnd"],
  }
);

// Verification Settings Schema
export const verificationSettingsSchema = z.object({
  verificationMethod: z.enum(["qr-code", "manual", "auto", "signup-only"] as const),
  requireLogin: z.boolean(),
  visibility: z.enum(["public", "unlisted", "organization_only"] as const),
});

// Event Form Schema
export const eventFormSchema = z.object({
  eventType: z.enum(["oneTime", "multiDay", "sameDayMultiArea"] as const),
  basicInfo: basicInfoSchema,
  schedule: z.object({
    oneTime: oneTimeSchema,
    multiDay: multiDaySchema,
    sameDayMultiArea: multiRoleSchema,
  }),
  verificationMethod: z.enum(["qr-code", "manual", "auto", "signup-only"] as const),
  requireLogin: z.boolean(),
  visibility: z.enum(["public", "unlisted", "organization_only"] as const),
});