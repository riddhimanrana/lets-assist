"use client";

import { Button } from "@/components/ui/button";
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogHeader, 
  DialogTitle, 
  DialogFooter, 
  DialogTrigger 
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useState } from "react";
import { LogOut, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { leaveOrganization } from "../actions";

interface LeaveOrganizationDialogProps {
  organizationId: string;
  organizationName: string;
}

export default function LeaveOrganizationDialog({ 
  organizationId, 
  organizationName 
}: LeaveOrganizationDialogProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  const handleLeaveOrganization = async () => {
    setIsLeaving(true);
    try {
      const result = await leaveOrganization(organizationId);
      if (result.error) {
        toast.error(result.error);
        setIsOpen(false);
      } else {
        toast.success(`You have left ${organizationName}`);
        router.push("/organization");
      }
    } catch (error) {
      console.error("Error leaving organization:", error);
      toast.error("Failed to leave organization. Please try again.");
      setIsOpen(false);
    } finally {
      setIsLeaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button 
          variant="outline" 
          size="sm"
          className="text-destructive border-destructive/30 hover:bg-destructive/10"
        >
          <LogOut className="h-3.5 w-3.5 mr-1.5" />
          Leave Organization
        </Button>
      </DialogTrigger>
      
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Leave Organization</DialogTitle>
          <DialogDescription>
            Are you sure you want to leave this organization? You will lose access to all organization resources.
          </DialogDescription>
        </DialogHeader>
        
        <DialogFooter className="mt-4 gap-2">
          <Button 
            variant="outline"
            onClick={() => setIsOpen(false)}
            disabled={isLeaving}
          >
            Cancel
          </Button>
          <Button 
            variant="destructive"
            onClick={handleLeaveOrganization}
            disabled={isLeaving}
          >
            {isLeaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Leaving...
              </>
            ) : (
              "Leave Organization"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
