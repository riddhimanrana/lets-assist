"use client";

import type { Organization } from "@/types";
import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { 
  Dialog, 
  DialogContent, 
  DialogFooter,
  DialogHeader, 
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { 
  Check, 
  ClipboardCopy, 
  Copy, 
  Link as LinkIcon, 
  RefreshCw,
  Share,
  CheckCircle2,
  QrCode
} from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { regenerateJoinCode } from "../create/actions";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import QRCode from "react-qr-code";

interface JoinCodeDialogProps {
  organization: Organization;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function JoinCodeDialog({ 
  organization, 
  open, 
  onOpenChange 
}: JoinCodeDialogProps) {
  const [joinCode, setJoinCode] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [copied, setCopied] = useState<"code" | "link" | "none">("none");
  const [joinLink, setJoinLink] = useState<string>("");
  const linkInputRef = useRef<HTMLInputElement>(null);
  
  // Fetch join code
  useEffect(() => {
    async function fetchJoinCode() {
      if (!open || !organization?.id) return;
      
      setLoading(true);
      
      const supabase = createClient();
      const { data, error } = await supabase
        .from("organizations")
        .select("join_code")
        .eq("id", organization.id)
        .single();
      
      if (error) {
        console.error("Error fetching join code:", error);
        toast.error("Failed to load join code");
      } else if (data) {
        setJoinCode(data.join_code);
        
        // Create join link
        const baseUrl = window.location.origin;
        setJoinLink(`${baseUrl}/organization/join?code=${data.join_code}`);
      }
      
      setLoading(false);
    }
    
    fetchJoinCode();
  }, [open, organization?.id]);
  
  // Reset copy status
  useEffect(() => {
    if (copied !== "none") {
      const timer = setTimeout(() => {
        setCopied("none");
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [copied]);
  
  // Copy functions
  const copyToClipboard = async (text: string, type: "code" | "link") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(type);
      toast.success(type === "code" ? "Join code copied" : "Invitation link copied");
    } catch (err) {
      console.error("Failed to copy:", err);
      toast.error("Failed to copy to clipboard");
    }
  };
  
  // Regenerate join code
  const handleRegenerateCode = async () => {
    if (!confirm("Are you sure you want to regenerate the join code? The old code will no longer work.")) {
      return;
    }
    
    setRegenerating(true);
    
    try {
      const result = await regenerateJoinCode(organization.id);
      
      if (result.error) {
        toast.error(result.error);
      } else {
        setJoinCode(result.joinCode);
        setJoinLink(`${window.location.origin}/organization/join?code=${result.joinCode}`);
        toast.success("Join code regenerated successfully");
      }
    } catch (error) {
      console.error("Error regenerating join code:", error);
      toast.error("Failed to regenerate join code");
    } finally {
      setRegenerating(false);
    }
  };
  
  // Share function (for mobile)
  const shareInvitation = async () => {
    if (!navigator.share) {
      toast.error("Sharing is not supported on this device");
      return;
    }
    
    try {
      await navigator.share({
        title: `Join ${organization.name} on Let's Assist`,
        text: `You've been invited to join ${organization.name}. Use code: ${joinCode}`,
        url: joinLink
      });
    } catch (err) {
      console.error("Error sharing:", err);
    }
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite Members</DialogTitle>
          <DialogDescription>
            Share this code or link with people you want to invite to {organization.name}.
          </DialogDescription>
        </DialogHeader>
        
        <Tabs defaultValue="code" className="mt-2">
          <TabsList className="grid grid-cols-3">
            <TabsTrigger value="code">Code</TabsTrigger>
            <TabsTrigger value="link">Link</TabsTrigger>
            <TabsTrigger value="qr">QR Code</TabsTrigger>
          </TabsList>
          
          <TabsContent value="code" className="pt-4">
            <div className="space-y-4">
              <div className="flex flex-col space-y-2">
                <Label htmlFor="join-code" className="text-sm">
                  Join Code
                </Label>
                <div className="flex items-center justify-between">
                  <div className="relative w-full">
                    <Input 
                      id="join-code"
                      value={loading ? "Loading..." : joinCode}
                      readOnly
                      className="pr-12 text-center font-mono text-lg tracking-widest"
                      disabled={loading}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="absolute right-1 top-1 h-7 w-7"
                      onClick={() => copyToClipboard(joinCode, "code")}
                      disabled={loading || regenerating}
                    >
                      {copied === "code" ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                      <span className="sr-only">Copy</span>
                    </Button>
                  </div>
                </div>
              </div>
              
              <Separator />
              
              <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-2">
                <Button 
                  onClick={handleRegenerateCode}
                  variant="outline"
                  disabled={loading || regenerating}
                  className="w-full gap-1.5"
                >
                  {regenerating ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      <span>Regenerating...</span>
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-4 w-4" />
                      <span>Regenerate Code</span>
                    </>
                  )}
                </Button>
                
                {typeof navigator.share === "function" && (
                  <Button 
                    onClick={shareInvitation}
                    variant="secondary"
                    disabled={loading}
                    className="w-full gap-1.5"
                  >
                    <Share className="h-4 w-4" />
                    <span>Share</span>
                  </Button>
                )}
              </div>
            </div>
          </TabsContent>
          
          <TabsContent value="link" className="pt-4">
            <div className="space-y-4">
              <div className="flex flex-col space-y-2">
                <Label htmlFor="invite-link" className="text-sm">
                  Invitation Link
                </Label>
                <div className="relative">
                  <Input
                    ref={linkInputRef}
                    id="invite-link"
                    value={loading ? "Loading..." : joinLink}
                    readOnly
                    className="pr-12"
                    disabled={loading}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="absolute right-1 top-1 h-7 w-7"
                    onClick={() => copyToClipboard(joinLink, "link")}
                    disabled={loading}
                  >
                    {copied === "link" ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <ClipboardCopy className="h-4 w-4" />
                    )}
                    <span className="sr-only">Copy link</span>
                  </Button>
                </div>
              </div>
              
              <div className="flex justify-end">
                <Button 
                  onClick={() => copyToClipboard(joinLink, "link")}
                  variant="secondary"
                  disabled={loading}
                  className="gap-1.5 w-full sm:w-auto"
                >
                  {copied === "link" ? (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <LinkIcon className="h-4 w-4" />
                      <span>Copy Link</span>
                    </>
                  )}
                </Button>
              </div>
            </div>
          </TabsContent>
          
          <TabsContent value="qr" className="pt-4">
            <div className="flex flex-col items-center justify-center space-y-4">
              <div className="bg-white p-4 rounded-lg">
                {!loading && (
                  <QRCode 
                    value={joinLink}
                    size={180}
                    bgColor="#FFFFFF"
                    fgColor="#000000"
                    level="M"
                  />
                )}
                {loading && <div className="h-[180px] w-[180px] animate-pulse bg-muted" />}
              </div>
              
              <div className="text-sm text-muted-foreground text-center">
                Scan this QR code to join <br /> <span className="font-semibold">{organization.name}</span>
              </div>
              
              <Button
                onClick={() => {
                  // Create canvas from QR code and download as image
                  const canvas = document.querySelector("canvas");
                  if (!canvas) return;
                  
                  const link = document.createElement("a");
                  link.download = `${organization.name.replace(/\s+/g, '-')}-join-qr.png`;
                  link.href = canvas.toDataURL("image/png");
                  link.click();
                }}
                variant="outline"
                className="gap-1.5"
                disabled={loading}
              >
                <QrCode className="h-4 w-4" />
                <span>Download QR Code</span>
              </Button>
            </div>
          </TabsContent>
        </Tabs>
        
        <DialogFooter className="flex flex-col sm:flex-row sm:justify-between sm:space-x-2">
          <span className="text-xs text-muted-foreground mb-4 sm:mb-0">
            Anyone with the code or link can join this organization.
          </span>
          <Button
            type="button"
            variant="default"
            onClick={() => onOpenChange(false)}
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
