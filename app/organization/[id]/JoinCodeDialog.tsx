"use client";

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
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Check,
  ClipboardCopy,
  Copy,
  Link as LinkIcon,
  RefreshCw,
  Share,
  CheckCircle2,
  QrCode,
} from "lucide-react";
import { getOrganizationJoinCode, regenerateJoinCode } from "../create/actions";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { QRCode } from "react-qrcode-logo";
import type { Organization } from "@/types";
import { copyToClipboard, isMobileDevice } from "@/lib/utils";

interface JoinCodeDialogProps {
  organization: OrganizationWithJoinCode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type OrganizationWithJoinCode = Organization & {
  join_code?: string | null;
  name: string;
};

export default function JoinCodeDialog({
  organization,
  open,
  onOpenChange,
}: JoinCodeDialogProps) {
  const [joinCode, setJoinCode] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [copied, setCopied] = useState<"code" | "link" | "none">("none");
  const [joinLink, setJoinLink] = useState<string>("");
  const linkInputRef = useRef<HTMLInputElement>(null);

  // Fetch join code
  useEffect(() => {
    async function fetchJoinCode() {
      if (!open || !organization?.id) return;

      setLoading(true);

      const result = await getOrganizationJoinCode(organization.id);

      if (result.error || !result.joinCode) {
        console.error("Error fetching join code:", result.error);
        toast.error("Failed to load join code");
      } else {
        setJoinCode(result.joinCode);

        // Create join link
        const baseUrl = window.location.origin;
        setJoinLink(`${baseUrl}/organization/join?code=${result.joinCode}`);
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
  const handleCopyToClipboard = async (text: string, type: "code" | "link") => {
    const success = await copyToClipboard(text);
    if (success) {
      setCopied(type);
      toast.success(
        type === "code" ? "Join code copied" : "Invitation link copied",
      );
    } else {
      toast.error("Failed to copy to clipboard");
    }
  };

  // Regenerate join code
  const handleRegenerateCode = async () => {
    setConfirmRegenerate(false);
    setRegenerating(true);

    try {
      const result = await regenerateJoinCode(organization.id);

      if (result.error) {
        toast.error(result.error);
      } else {
        setJoinCode(result.joinCode);
        setJoinLink(
          `${window.location.origin}/organization/join?code=${result.joinCode}`,
        );
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
        url: joinLink,
      });
    } catch (err) {
      console.error("Error sharing:", err);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite members</DialogTitle>
          <DialogDescription>
            Share this code or link with people you want to invite to{" "}
            {organization.name}.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="code" className="mt-2">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="code">Code</TabsTrigger>
            <TabsTrigger value="link">Link</TabsTrigger>
            <TabsTrigger value="qr">QR code</TabsTrigger>
          </TabsList>

          <TabsContent value="code" className="pt-4">
            <div className="space-y-4">
              <div className="flex flex-col space-y-2">
                <Label htmlFor="join-code" className="text-sm">
                  Join code
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
                      className="absolute right-0 top-0"
                      onClick={() => handleCopyToClipboard(joinCode, "code")}
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

              <div className="flex flex-col space-y-2">
                <Button
                  onClick={() => setConfirmRegenerate(true)}
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
                      <span>Regenerate code</span>
                    </>
                  )}
                </Button>

                {isMobileDevice() &&
                  typeof navigator !== "undefined" &&
                  typeof navigator.share === "function" && (
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
                  Invitation link
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
                    className="absolute right-0 top-0"
                    onClick={() => handleCopyToClipboard(joinLink, "link")}
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
                  onClick={() => handleCopyToClipboard(joinLink, "link")}
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
                      <span>Copy link</span>
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
                    logoImage="/logo.png"
                    qrStyle="dots"
                    eyeRadius={{ outer: 8, inner: 1 }}
                    removeQrCodeBehindLogo
                    logoPadding={2}
                    ecLevel="M"
                  />
                )}
                {loading && (
                  <div className="h-[180px] w-[180px] animate-pulse bg-muted" />
                )}
              </div>

              <div className="text-sm text-muted-foreground text-center">
                Scan this QR code to join <br />{" "}
                <span className="font-semibold">{organization.name}</span>
              </div>

              <Button
                onClick={() => {
                  // Create canvas from QR code and download as image
                  const canvas = document.querySelector("canvas");
                  if (!canvas) return;

                  const link = document.createElement("a");
                  link.download = `${organization.name.replace(/\s+/g, "-")}-join-qr.png`;
                  link.href = canvas.toDataURL("image/png");
                  link.click();
                }}
                variant="outline"
                className="gap-1.5"
                disabled={loading}
              >
                <QrCode className="h-4 w-4" />
                <span>Download QR code</span>
              </Button>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter className="sm:items-center sm:justify-between">
          <Button
            type="button"
            variant="default"
            onClick={() => onOpenChange(false)}
            className="sm:order-last"
          >
            Done
          </Button>
          <p className="text-muted-foreground text-sm">
            Anyone with the code or link can join this organization.
          </p>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={confirmRegenerate} onOpenChange={setConfirmRegenerate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regenerate the join code?</AlertDialogTitle>
            <AlertDialogDescription>
              The old code and any link or QR code made from it will stop
              working.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button variant="destructive" onClick={handleRegenerateCode}>
              Regenerate code
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
