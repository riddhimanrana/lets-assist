"use client";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogHeader, 
  DialogTitle 
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import { Check, Copy, Key, Loader2, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { regenerateJoinCode } from "../create/actions";

interface JoinCodeDisplayProps {
  organizationId: string;
  joinCode: string;
}

export default function JoinCodeDisplay({ 
  organizationId, 
  joinCode 
}: JoinCodeDisplayProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [displayedJoinCode, setDisplayedJoinCode] = useState(joinCode);
  
  // Reset copy status after 2 seconds
  useEffect(() => {
    if (isCopied) {
      const timer = setTimeout(() => {
        setIsCopied(false);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isCopied]);
  
  // Copy join code to clipboard
  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(displayedJoinCode);
      setIsCopied(true);
      toast.success("Join code copied to clipboard");
    } catch {
      toast.error("Failed to copy join code");
    }
  };
  
  // Regenerate join code
  const handleRegenerateJoinCode = async () => {
    if (!confirm("Are you sure you want to regenerate the join code? The old code will no longer work.")) {
      return;
    }
    
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
    }
  };
  
  return (
    <>
      <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            <Key className="h-3 w-3 mr-1" />
            Join Code
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-4" align="start">
          <div className="space-y-2 text-center">
            <h4 className="font-medium text-sm">Organization Join Code</h4>
            <p className="text-xs text-muted-foreground mb-2">
              Share this code with people you want to invite
            </p>
            
            <div className="flex items-center justify-center space-x-2">
              <div className="bg-muted text-lg font-mono rounded-md p-2 tracking-widest">
                {displayedJoinCode}
              </div>
              
              <Button 
                size="icon" 
                variant="outline" 
                className="h-8 w-8"
                onClick={copyToClipboard}
              >
                {isCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            
            <div className="flex justify-between mt-3">
              <Button 
                size="sm" 
                variant="outline" 
                onClick={handleRegenerateJoinCode} 
                disabled={isRegenerating}
                className="text-xs w-full"
              >
                {isRegenerating ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    Regenerating...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Regenerate
                  </>
                )}
              </Button>
            </div>
            
            <p className="text-xs text-muted-foreground mt-2">
              Regenerating will invalidate the previous join code
            </p>
          </div>
        </PopoverContent>
      </Popover>
      
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Organization Join Code</DialogTitle>
            <DialogDescription>
              Share this code with people you want to join your organization.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="join-code">Join Code</Label>
              <div className="flex items-center space-x-2">
                <Input 
                  id="join-code" 
                  value={displayedJoinCode} 
                  readOnly 
                  className="font-mono text-center text-lg tracking-widest"
                />
                <Button 
                  size="icon" 
                  variant="outline"
                  onClick={copyToClipboard}
                >
                  {isCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            
            <div className="flex justify-between">
              <Button 
                variant="outline"
                onClick={handleRegenerateJoinCode}
                disabled={isRegenerating}
              >
                {isRegenerating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Regenerating...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Regenerate Code
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
