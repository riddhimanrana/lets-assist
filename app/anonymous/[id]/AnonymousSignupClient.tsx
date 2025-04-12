"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CheckCircle2, Clock, Link as LinkIcon, User, Mail, Phone, Calendar, Info, Loader2, XCircle, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { format } from "date-fns";
import { formatTimeTo12Hour } from "@/lib/utils";
import { Project } from "@/types";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

// Helper function to format schedule slot (same as before)
const formatScheduleSlot = (project: Project, slotId: string) => {
  if (!project) return slotId;

  if (project.event_type === "oneTime") {
    if (slotId === "oneTime" && project.schedule.oneTime) {
      const dateStr = project.schedule.oneTime.date;
      const [year, month, day] = dateStr.split('-').map(Number);
      const date = new Date(year, month - 1, day);
      return `${format(date, "MMMM d, yyyy")} from ${formatTimeTo12Hour(project.schedule.oneTime.startTime)} to ${formatTimeTo12Hour(project.schedule.oneTime.endTime)}`;
    }
  }

  if (project.event_type === "multiDay") {
    const parts = slotId.split("-");
    if (parts.length >= 2) {
      const slotIndex = parts.pop();
      const date = parts.join("-");
      const day = project.schedule.multiDay?.find(d => d.date === date);
      if (day && slotIndex !== undefined) {
        const slotIdx = parseInt(slotIndex, 10);
        const slot = day.slots[slotIdx];
        if (slot) {
          const [year, month, dayNum] = date.split('-').map(Number);
          const utcDate = new Date(year, month - 1, dayNum);
          return `${format(utcDate, "EEEE, MMMM d, yyyy")} from ${formatTimeTo12Hour(slot.startTime)} to ${formatTimeTo12Hour(slot.endTime)}`;
        }
      }
    }
  }

  if (project.event_type === "sameDayMultiArea") {
    const role = project.schedule.sameDayMultiArea?.roles.find(r => r.name === slotId);
    if (role) {
      const eventDate = project.schedule.sameDayMultiArea?.date;
      if (eventDate) {
        const [year, month, day] = eventDate.split('-').map(Number);
        const utcDate = new Date(year, month - 1, day);
        return `${format(utcDate, "EEEE, MMMM d, yyyy")} - Role: ${role.name} (${formatTimeTo12Hour(role.startTime)} to ${formatTimeTo12Hour(role.endTime)})`;
      } else {
        return `Role: ${role.name} (${formatTimeTo12Hour(role.startTime)} to ${formatTimeTo12Hour(role.endTime)})`;
      }
    }
  }

  return slotId; // Fallback
};

// Types for the props
interface AnonymousSignupClientProps {
  id: string;
  name: string;
  email: string;
  phone_number: string | null;
  confirmed_at: string | null;
  status: string;
  schedule_id: string;
  project: Project;
  project_signup_id: string;
  isProjectCancelled: boolean; // Add this line
}

export default function AnonymousSignupClient({
  id,
  name,
  email,
  phone_number,
  confirmed_at,
  status,
  schedule_id,
  project,
  project_signup_id,
  isProjectCancelled
}: AnonymousSignupClientProps) {
  const router = useRouter();
  const isConfirmed = !!confirmed_at;
  const signupStatus = status;
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isDeleted, setIsDeleted] = useState(false);
  
  // Handle signup cancellation by deleting records
  const handleCancelSignup = async () => {
    if (!project_signup_id || !id) {
      toast.error("Unable to find signup details");
      setCancelDialogOpen(false);
      return;
    }
    
    try {
      setIsCancelling(true);
      const supabase = createClient();

      // First, delete the anonymous_signups record
      const { error: anonymousSignupError } = await supabase
        .from("anonymous_signups")
        .delete()
        .eq("id", id);
        
      if (anonymousSignupError) {
        throw new Error(`Error deleting anonymous signup: ${anonymousSignupError.message}`);
      }

      // Then, delete the project_signups record
      const { error: projectSignupError } = await supabase
        .from("project_signups")
        .delete()
        .eq("id", project_signup_id);
        
      if (projectSignupError) {
        throw new Error(`Error deleting project signup: ${projectSignupError.message}`);
      }
      
      
      
      
      // Close dialog and show success message
      setCancelDialogOpen(false);
      setIsDeleted(true);
      toast.success("Your signup has been cancelled successfully");

      // Redirect to projects page after a short delay
      setTimeout(() => {
        router.push("/projects");
      }, 3000);
    } catch (error) {
      console.error("Error cancelling signup:", error);
      toast.error("Failed to cancel signup. Please try again.");
      setCancelDialogOpen(false);
    } finally {
      setIsCancelling(false);
    }
  };

  // Render alert if project is cancelled
  if (isProjectCancelled) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Project Cancelled</AlertTitle>
        <AlertDescription>
          This project has been cancelled. Your signup is no longer valid.
        </AlertDescription>
      </Alert>
    );
  }

  if (isDeleted) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-10">
        <Card>
          <CardContent className="pt-6 pb-4">
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="mb-4 rounded-full bg-destructive/10 p-3">
                <XCircle className="h-8 w-8 text-destructive" />
              </div>
              <h2 className="text-2xl font-semibold mb-2">Signup Cancelled</h2>
              <p className="text-muted-foreground mb-6">
                Your signup for &quot;{project.title}&quot; has been cancelled successfully.
              </p>
              <p className="text-sm text-muted-foreground mb-4">
                Redirecting you to the projects page...
              </p>
              <Button asChild>
                <Link href="/projects">Browse Projects</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl px-4 py-10">
      <Card>
        <CardHeader>
            <CardTitle className="leading-tight">Your Volunteer Signup Details</CardTitle>
          <CardDescription>
            Details for your anonymous signup for the project:{" "}
            <Link href={`/projects/${project.id}`} className="text-primary hover:underline">
              {project.title}
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {!isConfirmed && signupStatus === 'pending' && (
            <Alert variant="warning">
              <Clock className="h-4 w-4" />
              <AlertTitle>Confirmation Pending</AlertTitle>
              <AlertDescription>
                Please check your email ({email}) for a confirmation link to finalize your signup.
              </AlertDescription>
            </Alert>
          )}
          
          {isConfirmed && signupStatus === 'approved' && (
             <Alert variant="success">
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>Signup Confirmed!</AlertTitle>
              <AlertDescription>
                Your spot for this project is confirmed. Thank you for volunteering!
              </AlertDescription>
            </Alert>
          )}
          
          {signupStatus === 'rejected' && (
             <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Signup Rejected</AlertTitle>
              <AlertDescription>
                This signup has been rejected by the project coordinator. Contact the project coordinator for more details.
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-3 text-sm">
            <h3 className="font-medium text-base mb-2">Your Information</h3>
            <div className="flex items-center gap-2 text-muted-foreground">
              <User className="h-4 w-4" /> Name: <span className="text-foreground font-medium">{name}</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Mail className="h-4 w-4" /> Email: <span className="text-foreground font-medium">{email}</span>
            </div>
            {phone_number && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Phone className="h-4 w-4" /> Phone: <span className="text-foreground font-medium">{phone_number}</span>
              </div>
            )}
          </div>

          <div className="space-y-3 text-sm">
            <h3 className="font-medium text-base mb-2">Project & Slot Details</h3>
             <div className="flex items-center gap-2 text-muted-foreground">
              <Calendar className="h-4 w-4 flex-shrink-0" /> Slot: <span className="text-foreground font-medium">{formatScheduleSlot(project, schedule_id)}</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Info className="h-4 w-4" /> Status:
              <Badge variant={
                signupStatus === 'approved' ? 'default' :
                signupStatus === 'pending' ? 'secondary' :
                'destructive'
              } className="capitalize ml-1">
                {signupStatus}
              </Badge>
            </div>
          </div>

          <div className="border-t pt-6 space-y-3">
             <h3 className="font-medium text-base mb-2">Manage Your Signup</h3>
             
             <div className="space-y-4">
              {(isConfirmed || signupStatus === 'pending') && signupStatus !== 'rejected' && (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Need to cancel your volunteer spot? You can do so by clicking the button below.
                  </p>
                  <Button 
                    variant="destructive" 
                    onClick={() => setCancelDialogOpen(true)}
                    className="flex items-center gap-2"
                  >
                    <XCircle className="h-4 w-4" />
                    Cancel My Signup
                  </Button>
                </div>
              )}
              
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Want to manage this signup with your Let&apos;s Assist account or create one? Linking your account allows you to easily track all your volunteer activities.
                </p>
                <Button disabled> {/* Disabled for now */}
                  <LinkIcon className="mr-2 h-4 w-4" />
                  Link to Let&apos;s Assist Account
                </Button>
                <p className="text-xs text-muted-foreground">
                  (Account linking functionality coming soon!)
                </p>
              </div>
             </div>
          </div>
        </CardContent>
      </Card>
      
      {/* Cancellation Confirmation Dialog */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Cancel Your Signup</DialogTitle>
            <DialogDescription>
              Are you sure you want to cancel your signup for this volunteer project? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="pt-2 pb-4">
            <Alert variant="destructive" className="border-destructive/70 bg-destructive/10">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle className="text-destructive">Important Note</AlertTitle>
              <AlertDescription className="text-destructive">
                This will permanently delete your signup information. You will need to sign up again if you change your mind later.
              </AlertDescription>
            </Alert>
          </div>
          <DialogFooter className="flex flex-col sm:flex-row gap-2 sm:justify-between">
            <Button 
              type="button" 
              variant="outline" 
              onClick={() => setCancelDialogOpen(false)}
              disabled={isCancelling}
            >
              Keep My Signup
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleCancelSignup}
              disabled={isCancelling}
              className="flex items-center gap-2"
            >
              {isCancelling && <Loader2 className="h-4 w-4 animate-spin" />}
              {isCancelling ? 'Cancelling...' : 'Yes, Cancel Signup'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
