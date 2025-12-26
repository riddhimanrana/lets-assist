"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Copy, CheckCircle2, RefreshCw, Loader2 } from "lucide-react";
import { regenerateJoinCode } from "../../create/actions";
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

interface JoinCodeAdminDisplayProps {
  organizationId: string;
  joinCode: string;
}

export default function JoinCodeAdminDisplay({
  organizationId,
  joinCode,
}: JoinCodeAdminDisplayProps) {
  const [displayedJoinCode, setDisplayedJoinCode] = useState(joinCode);
  const [isCopied, setIsCopied] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [showRegenerateAlert, setShowRegenerateAlert] = useState(false);
  
  // Copy join code to clipboard
  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(displayedJoinCode);
      setIsCopied(true);
      toast.success("Join code copied to clipboard");
      
      // Reset copy confirmation after 2 seconds
      setTimeout(() => {
        setIsCopied(false);
      }, 2000);
    } catch {
      toast.error("Failed to copy join code");
    }
  };
  
  // Regenerate join code
  const handleRegenerateJoinCode = async () => {
    setIsRegenerating(true);
    
    try {
      const result = await regenerateJoinCode(organizationId);
      
      if (result.error) {
        toast.error(result.error);
      } else {
        setDisplayedJoinCode(result.joinCode);
        toast.success("Join code regenerated successfully");
      }
    } catch (error) {
      console.error("Error regenerating join code:", error);
      toast.error("Failed to regenerate join code");
    } finally {
      setIsRegenerating(false);
      setShowRegenerateAlert(false);
    }
  };
  
  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="join-code">Current Join Code</Label>
        <div className="flex items-center gap-2 mt-1.5">
          <Input
            id="join-code"
            value={displayedJoinCode}
            readOnly
            className="font-mono text-lg tracking-wider text-center"
          />
          <Button
            type="button"
            size="icon"
            variant="outline"
            onClick={copyToClipboard}
            className="flex-shrink-0"
          >
            {isCopied ? (
              <CheckCircle2 className="h-4 w-4 text-primary" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
      
      <div>
        <AlertDialog
          open={showRegenerateAlert}
          onOpenChange={setShowRegenerateAlert}
        >
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              type="button"
              disabled={isRegenerating}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Regenerate Join Code
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Regenerate Join Code?</AlertDialogTitle>
              <AlertDialogDescription>
                This will invalidate the current join code. Anyone using the old code will no longer be able to join.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleRegenerateJoinCode}
                disabled={isRegenerating}
                className="bg-primary"
              >
                {isRegenerating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Regenerating...
                  </>
                ) : (
                  "Yes, Regenerate"
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
