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
import { User, Mail, Phone, Calendar, MapPin, Clock, Loader2 } from 'lucide-react';
import { getUserProfile } from '@/app/projects/[id]/actions';

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
    title: string;
    date: string;
    location: string;
    start_time?: string;
    end_time?: string;
  };
  isLoading?: boolean;
}

export function SignupConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  project,
  isLoading = false,
}: SignupConfirmationModalProps) {
  const [currentUserProfile, setCurrentUserProfile] = useState<UserProfile | null>(null);
  const [isFetchingProfile, setIsFetchingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

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
            <h4 className="font-semibold text-sm text-gray-900 dark:text-gray-100">
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
                  <span className="text-sm">
                    {project.start_time && formatTime(project.start_time)}
                    {project.start_time && project.end_time && ' - '}
                    {project.end_time && formatTime(project.end_time)}
                  </span>
                </div>
              )}
              <div className="flex items-center gap-3">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{project.location}</span>
              </div>
            </div>
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
