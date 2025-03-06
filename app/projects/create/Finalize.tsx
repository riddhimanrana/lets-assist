// Finalize.tsx - Final review step for project creation

"use client";

import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  MapPin,
  Calendar,
  Clock,
  Users,
  QrCode,
  UserCheck,
  Lock,
  User,
} from "lucide-react";

interface FinalizeProps {
  state: {
    eventType: string;
    verificationMethod: string;
    requireLogin: boolean;
    basicInfo: {
      title: string;
      location: string;
      description: string;
    };
    schedule: {
      oneTime: {
        date: string;
        startTime: string;
        endTime: string;
        volunteers: number;
      };
      multiDay: {
        date: string;
        slots: { startTime: string; endTime: string; volunteers: number }[];
      }[];
      sameDayMultiArea: {
        date: string;
        overallStart: string;
        overallEnd: string;
        roles: {
          name: string;
          startTime: string;
          endTime: string;
          volunteers: number;
        }[];
      };
    };
  };
}

export default function Finalize({ state }: FinalizeProps) {
  // Helper function to parse date string to Date object without timezone shifting
  const parseStringToDate = (dateString: string): Date | undefined => {
    if (!dateString) return undefined;
    const [year, month, day] = dateString.split('-').map(Number);
    return new Date(year, month - 1, day); // month is 0-indexed in JavaScript Date
  };

  // Helper function to format date for display
  const formatDateForDisplay = (dateString: string): string => {
    if (!dateString) return "Date not set";
    const date = parseStringToDate(dateString);
    return date ? format(date, "EEEE, MMMM d, yyyy") : "Date not set";
  };

  // Format verification method for display
  const getVerificationMethodDisplay = (method: string) => {
    switch (method) {
      case "qr-code":
        return {
          name: "QR Code Self Check-in",
          icon: <QrCode className="h-4 w-4 mr-2" />,
          description:
            "Volunteers will scan a QR code and log their own hours.",
        };
      case "auto":
        return {
          name: "Automatic Check-in/out",
          icon: <Clock className="h-4 w-4 mr-2" />,
          description:
            "System will automatically log attendance for the full scheduled time.",
        };
      case "manual":
        return {
          name: "Manual Check-in by Organizer",
          icon: <UserCheck className="h-4 w-4 mr-2" />,
          description:
            "You will manually log each volunteer's attendance and hours.",
        };
      default:
        return {
          name: "Not specified",
          icon: null,
          description: "",
        };
    }
  };

  const verificationMethod = getVerificationMethodDisplay(
    state.verificationMethod,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Review Your Project</CardTitle>
        <p className="text-sm text-muted-foreground">
          Please review your project details before creating
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <h3 className="text-lg font-semibold mb-1">
            {state.basicInfo.title}
          </h3>
          <div className="flex items-start gap-2 text-muted-foreground">
            <MapPin className="h-4 w-4 mt-0.5 shrink-0" />
            <span className="text-sm">{state.basicInfo.location}</span>
          </div>
          <Separator className="my-4" />
          <div className="text-sm">{state.basicInfo.description}</div>
        </div>

        <div className="bg-muted/50 p-4 rounded-lg space-y-4">
          <h4 className="font-medium">Event Type</h4>
          <Badge variant="outline" className="text-xs">
            {state.eventType === "oneTime" && "Single Event"}
            {state.eventType === "multiDay" && "Multiple Day Event"}
            {state.eventType === "sameDayMultiArea" && "Multi-Role Event"}
          </Badge>

          <h4 className="font-medium pt-2">Verification Method</h4>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="text-xs flex items-center gap-1"
            >
              {verificationMethod.icon}
              {verificationMethod.name}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {verificationMethod.description}
          </p>

          <h4 className="font-medium pt-2">Sign-up Requirements</h4>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="text-xs flex items-center gap-1"
            >
              {state.requireLogin ? (
                <>
                  <Lock className="h-4 w-4 mr-1" />
                  Account Required
                </>
              ) : (
                <>
                  <User className="h-4 w-4 mr-1" />
                  Anonymous Sign-ups Allowed
                </>
              )}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {state.requireLogin
              ? "Volunteers must create an account to sign up for your event."
              : "Anyone can sign up without creating an account (anonymous volunteers)."}
          </p>

          {state.eventType === "oneTime" && (
            <div className="space-y-2 pt-2">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">
                  {formatDateForDisplay(state.schedule.oneTime.date)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">
                  {state.schedule.oneTime.startTime} -{" "}
                  {state.schedule.oneTime.endTime}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">
                  {state.schedule.oneTime.volunteers} volunteer
                  {state.schedule.oneTime.volunteers !== 1 && "s"} needed
                </span>
              </div>
            </div>
          )}

          {state.eventType === "multiDay" && (
            <div className="space-y-4 pt-2">
              {state.schedule.multiDay.map((day, dayIndex) => (
                <div key={dayIndex} className="space-y-2 border-l-2 pl-3">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">
                      {formatDateForDisplay(day.date)}
                    </span>
                  </div>
                  {day.slots.map((slot, slotIndex) => (
                    <div key={slotIndex} className="ml-6 space-y-1">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">
                          {slot.startTime} - {slot.endTime}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">
                          {slot.volunteers} volunteer
                          {slot.volunteers !== 1 && "s"} needed
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {state.eventType === "sameDayMultiArea" && (
            <div className="space-y-4 pt-2">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">
                  {formatDateForDisplay(state.schedule.sameDayMultiArea.date)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">
                  Overall hours: {state.schedule.sameDayMultiArea.overallStart}{" "}
                  - {state.schedule.sameDayMultiArea.overallEnd}
                </span>
              </div>
              <Separator className="my-2" />
              <h5 className="font-medium text-sm">Roles:</h5>
              <div className="space-y-4">
                {state.schedule.sameDayMultiArea.roles.map(
                  (role, roleIndex) => (
                    <div key={roleIndex} className="space-y-1 border-l-2 pl-3">
                      <span className="text-sm font-medium">
                        {role.name || `Role ${roleIndex + 1}`}
                      </span>
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">
                          {role.startTime} - {role.endTime}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">
                          {role.volunteers} volunteer
                          {role.volunteers !== 1 && "s"} needed
                        </span>
                      </div>
                    </div>
                  ),
                )}
              </div>
            </div>
          )}
        </div>

        <div className="rounded-lg border p-4 flex items-start gap-4">
          <CheckCircle2 className="flex-shrink-0 h-8 w-8 text-primary mt-0.5" />
          <div>
            <h4 className="font-semibold">Ready to create your project</h4>
            <p className="text-sm text-muted-foreground">
              Click the &quot;Create&quot; button below to publish this project
              and start accepting volunteers.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
