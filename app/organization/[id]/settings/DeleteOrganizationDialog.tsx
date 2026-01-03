"use client";

import type { Organization } from "@/types";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { deleteOrganization } from "./actions";
import { useRouter } from "next/navigation";

interface DeleteOrganizationDialogProps {
  organization: Organization;
}

export default function DeleteOrganizationDialog({
  organization,
}: DeleteOrganizationDialogProps) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const router = useRouter();
  
  const expectedText = organization.username;
  const isConfirmTextValid = confirmText === expectedText;
  
  const handleDelete = async () => {
    if (!isConfirmTextValid) return;
    
    setIsDeleting(true);
    
    try {
      const result = await deleteOrganization(organization.id);
      
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Organization deleted successfully");
        setOpen(false);
        router.push("/organization");
      }
    } catch (error) {
      console.error("Error deleting organization:", error);
      toast.error("Failed to delete organization. Please try again.");
    } finally {
      setIsDeleting(false);
    }
  };
  
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm">
          <Trash2 className="h-4 w-4 mr-2" />
          Delete Organization
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-destructive">Delete Organization</DialogTitle>
          <DialogDescription>
            This action cannot be undone. It will permanently delete the organization, projects, and all associated data.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="bg-destructive/10 text-destructive p-3 rounded-md text-sm">
            <p>
              <strong>Warning:</strong> Deleting this organization will:
            </p>
            <ul className="list-disc ml-5 mt-2 space-y-1">
              <li>Remove all members from the organization</li>
              <li>Delete all organization data permanently</li>
              <li>This action is <strong>irreversible</strong></li>
            </ul>
          </div>
          
          <div className="space-y-2">
            <p className="text-sm font-medium">
              To confirm, type <span className="font-mono bg-muted px-1 py-0.5 rounded">
                {organization.username}
              </span> below:
            </p>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={`Type "${organization.username}" to confirm`}
              className={
                confirmText && !isConfirmTextValid 
                  ? "border-destructive focus:border-destructive" 
                  : ""
              }
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={!isConfirmTextValid || isDeleting}
          >
            {isDeleting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Deleting...
              </>
            ) : (
              "Delete Organization"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
