"use client";
import { safeConsole } from "@/lib/safe-console";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Check, Copy, Download, RefreshCw, Share } from "lucide-react";
import { getOrganizationJoinCode, regenerateJoinCode } from "../create/actions";
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
        safeConsole.error("Error fetching join code:", result.error);
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
      safeConsole.error("Error regenerating join code:", error);
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
      safeConsole.error("Error sharing:", err);
    }
  };

  const canShare =
    isMobileDevice() &&
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Invite members</DialogTitle>
          <DialogDescription>
            Share this code or link with people you want to invite to{" "}
            {organization.name}.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_auto]">
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="join-code">Join code</FieldLabel>
              <InputGroup className="h-11">
                <InputGroupInput
                  id="join-code"
                  value={loading ? "Loading..." : joinCode}
                  readOnly
                  className="font-mono text-lg tracking-widest"
                  disabled={loading}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    size="icon-sm"
                    aria-label="Copy"
                    onClick={() => handleCopyToClipboard(joinCode, "code")}
                    disabled={loading || regenerating}
                  >
                    {copied === "code" ? (
                      <Check aria-hidden="true" />
                    ) : (
                      <Copy aria-hidden="true" />
                    )}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
            </Field>

            <Field>
              <FieldLabel htmlFor="invite-link">Invitation link</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  ref={linkInputRef}
                  id="invite-link"
                  value={loading ? "Loading..." : joinLink}
                  readOnly
                  disabled={loading}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    size="icon-sm"
                    aria-label="Copy link"
                    onClick={() => handleCopyToClipboard(joinLink, "link")}
                    disabled={loading}
                  >
                    {copied === "link" ? (
                      <Check aria-hidden="true" />
                    ) : (
                      <Copy aria-hidden="true" />
                    )}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
            </Field>

            <div className="flex flex-wrap gap-2">
              {canShare ? (
                <Button
                  onClick={shareInvitation}
                  variant="outline"
                  disabled={loading}
                >
                  <Share data-icon="inline-start" aria-hidden="true" />
                  Share
                </Button>
              ) : null}
              <Button
                onClick={() => setConfirmRegenerate(true)}
                variant="outline"
                disabled={loading || regenerating}
              >
                <RefreshCw
                  data-icon="inline-start"
                  aria-hidden="true"
                  className={regenerating ? "animate-spin" : undefined}
                />
                {regenerating ? "Regenerating..." : "Regenerate code"}
              </Button>
            </div>
          </FieldGroup>

          <figure className="grid w-fit content-start gap-2">
            {/* QR codes need a white quiet zone to scan in either theme. */}
            <div className="w-fit rounded-lg border bg-white p-3">
              {loading ? (
                <Skeleton className="size-45 rounded-md" />
              ) : (
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
            </div>
            <figcaption className="text-muted-foreground max-w-52 text-sm">
              Scan this QR code to join{" "}
              <span className="text-foreground font-medium">
                {organization.name}
              </span>
            </figcaption>
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
              disabled={loading}
            >
              <Download data-icon="inline-start" aria-hidden="true" />
              Download QR code
            </Button>
          </figure>
        </div>

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
