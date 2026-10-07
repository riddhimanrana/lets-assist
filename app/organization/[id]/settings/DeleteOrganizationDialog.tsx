"use client";
import { safeConsole } from "@/lib/safe-console";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { Organization } from "@/types";

import { deleteOrganization } from "./actions";

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
      safeConsole.error("Error deleting organization:", error);
      toast.error("Failed to delete organization. Please try again.");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <Button variant="destructive">
            <Trash2 />
            Delete organization
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {organization.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This cannot be undone. It permanently deletes the organization, its
            projects and all associated data, and removes every member.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Field>
          <FieldLabel htmlFor="delete-organization-confirm">
            <span>
              To confirm, type{" "}
              <span className="bg-muted rounded px-1 py-0.5 font-mono">
                {organization.username}
              </span>{" "}
              below
            </span>
          </FieldLabel>
          <Input
            id="delete-organization-confirm"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={`Type "${organization.username}" to confirm`}
            aria-invalid={Boolean(confirmText) && !isConfirmTextValid}
            autoComplete="off"
          />
        </Field>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={handleDelete}
            disabled={!isConfirmTextValid || isDeleting}
          >
            {isDeleting ? (
              <>
                <Loader2 className="animate-spin" />
                Deleting...
              </>
            ) : (
              "Delete organization"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
