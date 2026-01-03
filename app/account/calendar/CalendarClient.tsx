"use client";

import { useState } from "react";
import Image from "next/image";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Calendar,
  CheckCircle,
  XCircle,
  Trash2,
  AlertCircle,
  Info,
  CalendarPlus,
  CalendarCheck,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "@/hooks/use-toast";
import type { CalendarConnection } from "@/types";

interface CalendarClientProps {
  connection: CalendarConnection | null;
  creatorProjects: Array<{
    id: string;
    title: string;
    description: string | null;
    start_date: string;
    end_date: string | null;
    location: string | null;
    creator_calendar_event_id: string;
    creator_synced_at: string;
    schedule_type: string;
  }>;
  volunteerSignups: Array<{
    id: string;
    volunteer_calendar_event_id: string | null;
    volunteer_synced_at: string | null;
    scheduled_start: string | null;
    scheduled_end: string | null;
    projects: {
      id: string;
      title: string;
      description: string | null;
      location: string | null;
      schedule_type: string;
    } | null;
  }>;
}

export default function CalendarClient({
  connection,
  creatorProjects,
  volunteerSignups,
}: CalendarClientProps) {
  const router = useRouter();
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);
  const [removingEventId, setRemovingEventId] = useState<string | null>(null);

  const handleConnect = async () => {
    try {
      const response = await fetch("/api/calendar/google/connect");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to connect calendar");
      }

      // Redirect to Google OAuth
      window.location.href = data.authUrl;
    } catch (error) {
      console.error("Failed to connect calendar:", error);
      toast({
        title: "Connection Failed",
        description:
          error instanceof Error
            ? error.message
            : "Failed to connect to Google Calendar",
        variant: "destructive",
      });
    }
  };

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      const response = await fetch("/api/calendar/google/disconnect", {
        method: "POST",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to disconnect calendar");
      }

      toast({
        title: "Calendar Disconnected",
        description:
          "Your Google Calendar has been disconnected. Existing synced events will remain in your calendar.",
      });

      router.refresh();
    } catch (error) {
      console.error("Failed to disconnect calendar:", error);
      toast({
        title: "Disconnection Failed",
        description:
          error instanceof Error
            ? error.message
            : "Failed to disconnect Google Calendar",
        variant: "destructive",
      });
    } finally {
      setIsDisconnecting(false);
      setShowDisconnectDialog(false);
    }
  };

  const handleRemoveEvent = async (
    eventId: string,
    eventType: "creator" | "volunteer"
  ) => {
    setRemovingEventId(eventId);
    try {
      const response = await fetch("/api/calendar/remove-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, eventType }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to remove event");
      }

      toast({
        title: "Event Removed",
        description: "The event has been removed from your calendar.",
      });

      router.refresh();
    } catch (error) {
      console.error("Failed to remove event:", error);
      toast({
        title: "Removal Failed",
        description:
          error instanceof Error
            ? error.message
            : "Failed to remove event from calendar",
        variant: "destructive",
      });
    } finally {
      setRemovingEventId(null);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-5xl">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Calendar Settings</h1>
        <p className="text-muted-foreground mt-1">
          Manage your calendar integrations and synced events
        </p>
      </div>

      {/* Connection Status Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center text-xl gap-2">
            <Image
              src="/googlecalendar.svg"
              alt="Google Calendar"
              width={20}
              height={20}
              className="h-5 w-5 mr-1"
            />
            Google Calendar Connection
          </CardTitle>
          <CardDescription>
            Connect your Google Calendar to automatically sync your projects and
            volunteer signups
          </CardDescription>
        </CardHeader>
        <CardContent>
          {connection ? (
            <div className="space-y-4">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <CheckCircle className="h-5 w-5 text-chart-5 mt-0.5" />
                  <div>
                    <p className="font-medium">Connected</p>
                    <p className="text-sm text-muted-foreground">
                      {connection.calendar_email}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Connected on{" "}
                      {new Date(connection.created_at).toLocaleDateString(
                        "en-US",
                        {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        }
                      )}
                    </p>
                  </div>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setShowDisconnectDialog(true)}
                  disabled={isDisconnecting}
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Disconnect
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="font-medium">Not Connected</p>
                  <p className="text-sm text-muted-foreground">
                    Connect your Google Calendar to sync events automatically
                  </p>
                </div>
              </div>
              <Button onClick={handleConnect}>
                <Calendar className="h-4 w-4 mr-1" />
                Connect Google Calendar
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Synced Events */}
      {connection && (creatorProjects.length > 0 || volunteerSignups.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarCheck className="h-5 w-5" />
              Synced Events
            </CardTitle>
            <CardDescription>
              Events that have been synced to your Google Calendar
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Creator Projects */}
            {creatorProjects.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <CalendarPlus className="h-4 w-4" />
                  Projects You Created ({creatorProjects.length})
                </h3>
                <div className="space-y-2">
                  {creatorProjects.map((project) => (
                    <div
                      key={project.id}
                      className="flex items-start justify-between p-3 border rounded-lg hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{project.title}</p>
                        <p className="text-sm text-muted-foreground">
                          {formatDate(project.start_date)}
                          {project.end_date &&
                            project.end_date !== project.start_date &&
                            ` - ${formatDate(project.end_date)}`}
                        </p>
                        {project.location && (
                          <p className="text-xs text-muted-foreground mt-1">
                            📍 {project.location}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">
                          Synced {formatDate(project.creator_synced_at)}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          handleRemoveEvent(project.id, "creator")
                        }
                        disabled={removingEventId === project.id}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Volunteer Signups */}
            {volunteerSignups.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Your Volunteer Signups ({volunteerSignups.length})
                </h3>
                <div className="space-y-2">
                  {volunteerSignups.filter(signup => signup.projects !== null).map((signup) => (
                    <div
                      key={signup.id}
                      className="flex items-start justify-between p-3 border rounded-lg hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">
                          {signup.projects!.title}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {signup.scheduled_start && formatDate(signup.scheduled_start)}
                          {signup.scheduled_end &&
                            signup.scheduled_end !== signup.scheduled_start &&
                            ` - ${formatDate(signup.scheduled_end)}`}
                        </p>
                        {signup.projects!.location && (
                          <p className="text-xs text-muted-foreground mt-1">
                            📍 {signup.projects!.location}
                          </p>
                        )}
                        {signup.volunteer_synced_at && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Synced {formatDate(signup.volunteer_synced_at)}
                          </p>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          handleRemoveEvent(signup.id, "volunteer")
                        }
                        disabled={removingEventId === signup.id}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* How It Works */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center text-xl gap-2">
            <Info className="h-5 w-5" />
            How It Works
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3 text-sm">
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">
                1
              </div>
              <div>
                <p className="font-medium">Connect Your Calendar</p>
                <p className="text-muted-foreground">
                  Authorize Let&apos;s Assist to access your Google Calendar.
                  We only request permissions to create and manage events.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">
                2
              </div>
              <div>
                <p className="font-medium">Sync Events</p>
                <p className="text-muted-foreground">
                  When you create a project or sign up for volunteering,
                  you&apos;ll have the option to add it to your calendar. Events
                  are automatically synced.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">
                3
              </div>
              <div>
                <p className="font-medium">Stay Updated</p>
                <p className="text-muted-foreground">
                  If a project is updated or cancelled, the calendar event will
                  be automatically updated or removed.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">
                4
              </div>
              <div>
                <p className="font-medium">iCal Alternative</p>
                <p className="text-muted-foreground">
                  Don&apos;t use Google Calendar? You can download .ics files
                  for Apple Calendar, Outlook, and other calendar apps.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Disconnect Dialog */}
      <AlertDialog
        open={showDisconnectDialog}
        onOpenChange={setShowDisconnectDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Google Calendar?</AlertDialogTitle>
            <AlertDialogDescription>
              This will disconnect your Google Calendar from Let&apos;s Assist.
              Your existing synced events will remain in your calendar, but new
              events won&apos;t be automatically synced.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDisconnect}
              disabled={isDisconnecting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDisconnecting ? "Disconnecting..." : "Disconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
