'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AlertTriangle, Calendar, MapPin, Clock, Loader2 } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import { cancelSignup } from '@/app/projects/[id]/actions';
import { toast } from 'sonner';


interface CancelSignupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (scheduleId: string) => void; // Callback when cancellation succeeds
  project: {
    title: string;
    date: string;
    location: string;
    start_time?: string;
    end_time?: string;
  };
  projectId: string; // Project ID for database queries
  scheduleId: string; // Schedule ID for the specific slot
  userId: string; // Current user ID
}

export function CancelSignupModal({
  isOpen,
  onClose,
  onSuccess,
  project,
  projectId,
  scheduleId,
  userId,
}: CancelSignupModalProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleConfirmCancel = async () => {
    console.log('CancelSignupModal: Starting cancellation process');
    console.log('Project ID:', projectId);
    console.log('Schedule ID:', scheduleId);
    console.log('User ID:', userId);
    
    setIsLoading(true);
    
    try {
      const supabase = createClient();
      
      // Find the signup record to cancel
      const { data: allSignups, error: queryError } = await supabase
        .from("project_signups")
        .select("*")
        .eq("project_id", projectId)
        .eq("schedule_id", scheduleId)
        .eq("user_id", userId);
      
      console.log('Found signups:', allSignups);
      console.log('Query error:', queryError);
      
      if (queryError) {
        console.error("Error querying signups:", queryError);
        toast.error("Failed to find signup record");
        return;
      }
      
      // Find any approved signup (most common case)
      let targetSignup = allSignups?.find(s => s.status === "approved");
      
      // If no approved signup, try pending status
      if (!targetSignup) {
        targetSignup = allSignups?.find(s => s.status === "pending");
      }
      
      // If still no signup, take any status
      if (!targetSignup && allSignups && allSignups.length > 0) {
        targetSignup = allSignups[0];
      }

      if (!targetSignup) {
        console.error("No signup found to cancel");
        toast.error("No signup found to cancel");
        return;
      }

      console.log('Attempting to cancel signup:', targetSignup);
      
      // Call the server action to cancel the signup
      const result = await cancelSignup(targetSignup.id);
      console.log('Cancel result:', result);
      
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Successfully cancelled signup");
        onSuccess(scheduleId); // Notify parent component of successful cancellation
        onClose(); // Close the modal
      }
    } catch (error) {
      console.error("Error cancelling signup:", error);
      toast.error("Failed to cancel signup");
    } finally {
      setIsLoading(false);
    }
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

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Cancel Event Signup
          </DialogTitle>
          <DialogDescription>
            Are you sure you want to cancel your signup for this event? This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="rounded-lg border p-4 space-y-3">
            <h4 className="font-semibold text-sm">
              Event You&apos;re Cancelling
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
          
          <div className="bg-chart-4/20 border border-chart-4 rounded-lg p-3">
            <p className="text-sm text-chart-4">
              <strong>Note:</strong> Cancelling your signup may affect the organization&apos;s planning. 
              If you need to cancel close to the event date, consider contacting the organizers directly.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isLoading}
          >
            Keep Signup
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirmCancel}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Cancelling...
              </>
            ) : (
              'Cancel Signup'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
