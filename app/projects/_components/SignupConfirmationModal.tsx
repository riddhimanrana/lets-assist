'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { User, Mail, Phone, Calendar, MapPin, Clock, Loader2, ChevronDown, Download } from 'lucide-react';
import Image from "next/image";
import { getUserProfile } from '@/app/projects/[id]/actions';
import { toast } from "sonner";
import { TimezoneBadge } from '@/components/shared/TimezoneBadge';
import { WaiverSignatureSection } from '@/app/projects/_components/WaiverSignatureSection';
import type { Project, WaiverSignatureInput, WaiverTemplate } from '@/types';

interface UserProfile {
  full_name: string | null;
  email: string | null;
  phone: string | null;
}

interface SignupConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (comment?: string, waiverSignature?: WaiverSignatureInput | null) => void;
  enableVolunteerComments?: boolean;
  waiverRequired?: boolean;
  waiverAllowUpload?: boolean;
  waiverTemplate?: WaiverTemplate | null;
  waiverPdfUrl?: string | null;
  project: {
    id: string;
    title: string;
    date: string;
    location: string;
    start_time?: string;
    end_time?: string;
    project_timezone?: string;
  };
  scheduleId: string;
  isLoading?: boolean;
}

export function SignupConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  enableVolunteerComments = false,
  waiverRequired = false,
  waiverAllowUpload = true,
  waiverTemplate = null,
  waiverPdfUrl = null,
  project,
  scheduleId,
  isLoading = false,
}: SignupConfirmationModalProps) {
  const [currentUserProfile, setCurrentUserProfile] = useState<UserProfile | null>(null);
  const [isFetchingProfile, setIsFetchingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [waiverSignature, setWaiverSignature] = useState<WaiverSignatureInput | null>(null);

  // Calendar connection state
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [connectedEmail, setConnectedEmail] = useState<string | null>(null);
  const [checkingConnection, setCheckingConnection] = useState(false);
  const [connectingCalendar, setConnectingCalendar] = useState(false);
  const [comment, setComment] = useState('');

  useEffect(() => {
    if (!isOpen) {
      setComment('');
      setWaiverSignature(null);
    }
  }, [isOpen]);

  useEffect(() => {
    const fetchUserProfile = async () => {
      if (!isOpen) {
        return;
      }

      if (currentUserProfile) return;

      setIsFetchingProfile(true);
      setProfileError(null);

      try {
        const result = await getUserProfile();

        if (result.error) {
          setProfileError(result.error);
          setCurrentUserProfile(null);
        } else if (result.profile) {
          setCurrentUserProfile(result.profile);
        }
      } catch (error) {
        console.error('Error fetching user profile:', error);
        setProfileError('An unexpected error occurred while fetching your information.');
        setCurrentUserProfile(null);
      } finally {
        setIsFetchingProfile(false);
      }
    };

    fetchUserProfile();
  }, [isOpen, currentUserProfile]);

  // Check calendar connection status
  useEffect(() => {
    const checkCalendarConnection = async () => {
      if (!isOpen) return;

      // Check if we just returned from OAuth
      const justConnected = sessionStorage.getItem('calendarJustConnected');
      if (justConnected === 'true') {
        sessionStorage.removeItem('calendarJustConnected');
        // Small delay to ensure connection is saved
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      setCheckingConnection(true);
      try {
        const response = await fetch('/api/calendar/connection-status');
        const data = await response.json();

        // API returns 'connected' not 'isConnected'
        setCalendarConnected(data.connected || false);
        setConnectedEmail(data.calendar_email || null);
      } catch (error) {
        console.error('Error checking calendar connection:', error);
        setCalendarConnected(false);
        setConnectedEmail(null);
      } finally {
        setCheckingConnection(false);
      }
    };

    checkCalendarConnection();
  }, [isOpen]);

  const handleConnectCalendar = async () => {
    setConnectingCalendar(true);
    try {
      // Store modal state before OAuth
      sessionStorage.setItem('signupModalState', JSON.stringify({
        projectId: project.id,
        scheduleId: scheduleId,
        returnToModal: true,
      }));

      // Build return URL for this project
      const returnUrl = `/projects/${project.id}`;

      // Redirect to OAuth
      window.location.href = `/api/calendar/google/connect?scopes=calendar&return_to=${encodeURIComponent(returnUrl)}`;
    } catch (error) {
      console.error('Failed to connect calendar:', error);
      toast.error('Connection Failed', {
        description: error instanceof Error ? error.message : 'Failed to connect Google Calendar',
      });
      setConnectingCalendar(false);
    }
  };

  const handleDownloadICal = () => {
    // Import the iCal utilities
    import('@/utils/ical').then(({ generateProjectICalFile, downloadICalFile, generateICalFilename }) => {
      try {
        // We need to create a minimal project object with the schedule
        const projectData: Project = {
          id: project.id,
          title: project.title,
          description: '',
          location: project.location,
          event_type: 'oneTime',
          schedule: {
            oneTime: {
              date: project.date,
              startTime: project.start_time || '00:00',
              endTime: project.end_time || '23:59',
              volunteers: 1,
            }
          },
          verification_method: 'manual',
          require_login: false,
          creator_id: '',
          status: 'upcoming',
          visibility: 'public',
          pause_signups: false,
          profiles: {
            full_name: '',
            email: '',
            avatar_url: null,
            username: '',
            created_at: '',
          },
          created_at: '',
          published: {},
        };

        const icalContent = generateProjectICalFile(projectData, scheduleId);
        const filename = generateICalFilename(projectData, scheduleId);
        downloadICalFile(icalContent, filename);

        toast.success('iCal Downloaded', {
          description: 'Open the file to add the event to your calendar app',
        });
      } catch (error) {
        console.error('Failed to download iCal:', error);
        toast.error('Download Failed', {
          description: 'Failed to download calendar file',
        });
      }
    });
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const handleConfirm = () => {
    const trimmed = comment.trim();
    onConfirm(trimmed.length > 0 ? trimmed : undefined, waiverSignature);
  };

  const formatTime = (timeString: string) => {
    const [hours, minutes] = timeString.split(':');
    const date = new Date();
    date.setHours(parseInt(hours), parseInt(minutes));
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const waiverSatisfied = !waiverRequired || !!waiverSignature;
  const canConfirm = !isLoading && !isFetchingProfile && !profileError && !!currentUserProfile && waiverSatisfied;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-[95vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Confirm Event Signup</DialogTitle>
          <DialogDescription>
            Please review your information and event details before confirming your signup.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* User Information */}
          <div className="space-y-3">
            <h4 className="font-semibold text-sm">
              Your Information
            </h4>
            {isFetchingProfile ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading your information...
              </div>
            ) : profileError ? (
              <div className="text-sm text-red-600">{profileError}</div>
            ) : currentUserProfile ? (
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">
                    {currentUserProfile.full_name || 'No name provided'}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">
                    {currentUserProfile.email || 'No email provided'}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">
                    {currentUserProfile.phone || 'No phone number provided'}
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                Could not load user information.
              </div>
            )}
          </div>

          {/* Event Information */}
          <div className="space-y-3">
            <h4 className="font-semibold text-sm text-text">
              Event Details
            </h4>
            <div className="space-y-2">
              <div className="flex items-start gap-3">
                <Calendar className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div>
                  <div className="text-sm font-medium">{project.title}</div>
                  <div className="text-sm text-muted-foreground">
                    {formatDate(project.date)}
                  </div>
                </div>
              </div>
              {(project.start_time || project.end_time) && (
                <div className="flex items-center gap-3">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <div className="flex items-center gap-2">
                    <span className="text-sm">
                      {project.start_time && formatTime(project.start_time)}
                      {project.start_time && project.end_time && ' - '}
                      {project.end_time && formatTime(project.end_time)}
                    </span>
                    {project.project_timezone && (
                      <TimezoneBadge timezone={project.project_timezone} />
                    )}
                  </div>
                </div>
              )}
              <div className="flex items-center gap-3">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{project.location}</span>
              </div>
            </div>
          </div>

          {waiverRequired && (
            <div className="space-y-3 pt-3 border-t">
              <WaiverSignatureSection
                template={waiverTemplate || null}
                waiverPdfUrl={waiverPdfUrl}
                signerName={currentUserProfile?.full_name || undefined}
                signerEmail={currentUserProfile?.email || undefined}
                allowUpload={waiverAllowUpload}
                required
                onChange={setWaiverSignature}
              />
            </div>
          )}

          {enableVolunteerComments && (
            <div className="space-y-3 pt-3 border-t">
              <div className="flex justify-between items-center">
                <h4 className="font-semibold text-sm text-text">Comment (Optional)</h4>
                <span className={`text-xs ${comment.length > 100 ? "text-destructive" : "text-muted-foreground"}`}>
                  {comment.length}/100
                </span>
              </div>
              <Textarea
                placeholder="Add a note for the organizer..."
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                maxLength={100}
                className="resize-none text-sm"
              />
              <div className="text-xs text-muted-foreground">
                Brief note visible to the organizer.
              </div>
            </div>
          )}

          {/* Calendar Integration Section */}
          <div className="space-y-3 pt-3 border-t">
            <h4 className="font-semibold text-sm text-text">
              Add to Calendar
            </h4>
            {checkingConnection ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Checking connection...
              </div>
            ) : calendarConnected ? (
              <div className="flex items-center justify-between gap-3 p-3 bg-success/10 border border-success/80 rounded-lg max-w-md">
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="h-8 w-8 rounded-full bg-success/20 flex items-center justify-center shrink-0">
                    <Image className="h-4 w-4" src="/googlecalendar.svg" alt="Google Calendar" width={16} height={16} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-success truncate">
                      Google Calendar Connected
                    </div>
                    {connectedEmail && (
                      <div className="text-xs text-success/80 truncate">
                        {connectedEmail}
                      </div>
                    )}
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 shrink-0"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={handleDownloadICal}>
                      <Download className="h-4 w-4 mr-2" />
                      Download as iCal
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ) : (
              <Button
                variant="outline"
                className="w-full max-w-md justify-start h-auto p-3"
                onClick={handleConnectCalendar}
                disabled={connectingCalendar}
              >
                <div className="flex items-center gap-3 w-full">
                  {connectingCalendar ? (
                    <Loader2 className="h-5 w-5 animate-spin shrink-0" />
                  ) : (
                    <Image
                      src="/googlecalendar.svg"
                      alt="Google Calendar"
                      width={20}
                      height={20}
                      className="h-5 w-5 mr-1"
                    />
                  )}
                  <div className="text-left flex-1">
                    <div className="text-sm font-medium">
                      Connect Google Calendar
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Auto-sync events to your calendar
                    </div>
                  </div>
                </div>
              </Button>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isLoading || isFetchingProfile}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            className="mb-2"
            disabled={!canConfirm}
          >
            {isLoading ? 'Signing up...' : isFetchingProfile ? 'Loading...' : 'Confirm Signup'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
