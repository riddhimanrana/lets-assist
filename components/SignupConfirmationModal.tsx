'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
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
import { User, Mail, Phone, Calendar, MapPin, Clock, Loader2, Check, ChevronDown, Download } from 'lucide-react';
import Image from "next/image";
import { getUserProfile } from '@/app/projects/[id]/actions';
import { toast } from '@/hooks/use-toast';
import { TimezoneBadge } from '@/components/TimezoneBadge';

interface UserProfile {
  full_name: string | null;
  email: string | null;
  phone: string | null;
}

interface SignupConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
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
  project,
  scheduleId,
  isLoading = false,
}: SignupConfirmationModalProps) {
  const [currentUserProfile, setCurrentUserProfile] = useState<UserProfile | null>(null);
  const [isFetchingProfile, setIsFetchingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  
  // Calendar connection state
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [connectedEmail, setConnectedEmail] = useState<string | null>(null);
  const [checkingConnection, setCheckingConnection] = useState(false);
  const [connectingCalendar, setConnectingCalendar] = useState(false);

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
      
      // Get OAuth URL with return parameter
      const response = await fetch(`/api/calendar/google/connect?return_to=${encodeURIComponent(returnUrl)}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to connect calendar');
      }

      // Redirect to OAuth
      window.location.href = data.authUrl;
    } catch (error) {
      console.error('Failed to connect calendar:', error);
      toast({
        title: 'Connection Failed',
        description: error instanceof Error ? error.message : 'Failed to connect Google Calendar',
        variant: 'destructive',
      });
      setConnectingCalendar(false);
    }
  };

  const handleDownloadICal = () => {
    // Import the iCal utilities
    import('@/utils/ical').then(({ generateProjectICalFile, downloadICalFile, generateICalFilename }) => {
      try {
        // We need to create a minimal project object with the schedule
        const projectData: any = {
          ...project,
          event_type: 'oneTime' as const,
          schedule: {
            oneTime: {
              date: project.date,
              startTime: project.start_time || '00:00',
              endTime: project.end_time || '23:59',
              slots: 1,
            }
          },
          description: '',
          creator_id: '',
          organization_id: null,
          status: 'active' as const,
          is_private: false,
          created_at: '',
          updated_at: '',
          published: {},
          required_volunteers: 1,
          verification_method: 'qr',
          require_login: false,
          pause_signups: false,
        };

        const icalContent = generateProjectICalFile(projectData, scheduleId);
        const filename = generateICalFilename(projectData, scheduleId);
        downloadICalFile(icalContent, filename);

        toast({
          title: 'iCal Downloaded',
          description: 'Open the file to add the event to your calendar app',
        });
      } catch (error) {
        console.error('Failed to download iCal:', error);
        toast({
          title: 'Download Failed',
          description: 'Failed to download calendar file',
          variant: 'destructive',
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

  const canConfirm = !isLoading && !isFetchingProfile && !profileError && !!currentUserProfile;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
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
              <div className="flex items-center justify-between gap-3 p-3 bg-chart-5/10 border border-chart-5/80 rounded-lg">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="flex-shrink-0">
                    <div className="h-8 w-8 rounded-full bg-chart-5/20 flex items-center justify-center">
                      <Image
              src="/googlecalendar.svg"
              alt="Google Calendar"
              width={20}
              height={20}
              className="h-4 w-4"
            />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-chart-5">
                      Connected to Google Calendar
                    </div>
                    {connectedEmail && (
                      <div className="text-xs text-chart-5/80 truncate">
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
                      className="h-8 w-8 p-0 flex-shrink-0"
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
                className="w-full justify-start h-auto p-3"
                onClick={handleConnectCalendar}
                disabled={connectingCalendar}
              >
                <div className="flex items-center gap-3 w-full">
                  {connectingCalendar ? (
                    <Loader2 className="h-5 w-5 animate-spin flex-shrink-0" />
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
            onClick={onConfirm}
            disabled={!canConfirm}
          >
            {isLoading ? 'Signing up...' : isFetchingProfile ? 'Loading...' : 'Confirm Signup'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
