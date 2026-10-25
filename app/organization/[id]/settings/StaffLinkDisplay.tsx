"use client";

import { useState, useEffect } from "react";
import { Check, Copy, Link as LinkIcon, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { SettingsSection } from "@/components/layout/SettingsSection";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { copyToClipboard } from "@/lib/utils";

import {
  generateStaffLink,
  revokeStaffLink,
  getStaffLinkDetails,
} from "./actions";

interface StaffLinkDisplayProps {
  organizationId: string;
  organizationUsername: string;
}

const expirationOptions = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
] as const;

const getExpirationLabel = (value: string | null | undefined) => {
  const normalized = value ?? "";
  return (
    expirationOptions.find((option) => option.value === normalized)?.label ||
    normalized
  );
};

export default function StaffLinkDisplay({
  organizationId,
  organizationUsername,
}: StaffLinkDisplayProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [isExpired, setIsExpired] = useState(false);
  const [showRevokeAlert, setShowRevokeAlert] = useState(false);
  const [expirationDays, setExpirationDays] = useState("30");
  const [copied, setCopied] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);

  // Get base URL for the staff link
  const baseUrl =
    typeof window !== "undefined" ? `${window.location.origin}/signup` : "";

  const staffLink = token
    ? `${baseUrl}?staff_token=${token}&org=${organizationUsername}`
    : "";

  // Load initial token status
  useEffect(() => {
    async function loadStaffLink() {
      setIsInitializing(true);
      const result = await getStaffLinkDetails(organizationId);
      if (!result.error) {
        setHasToken(result.hasToken ?? false);
        setToken(result.token ?? null);
        setExpiresAt(result.expiresAt ?? null);
        setIsExpired(result.isExpired ?? false);
      }
      setIsInitializing(false);
    }
    loadStaffLink();
  }, [organizationId]);

  const handleGenerate = async () => {
    setIsLoading(true);
    try {
      const result = await generateStaffLink(
        organizationId,
        parseInt(expirationDays, 10),
      );

      if (result.error) {
        toast.error(result.error);
        return;
      }

      if (result.success && result.token) {
        setHasToken(true);
        setToken(result.token);
        setExpiresAt(result.expiresAt ?? null);
        setIsExpired(false);
        toast.success("Staff invite link generated successfully");
      }
    } catch {
      toast.error("Failed to generate staff link");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRevoke = async () => {
    setIsLoading(true);
    try {
      const result = await revokeStaffLink(organizationId);

      if (result.error) {
        toast.error(result.error);
        return;
      }

      if (result.success) {
        setHasToken(false);
        setToken(null);
        setExpiresAt(null);
        setIsExpired(false);
        toast.success("Staff invite link revoked");
      }
    } catch {
      toast.error("Failed to revoke staff link");
    } finally {
      setIsLoading(false);
      setShowRevokeAlert(false);
    }
  };

  const handleCopy = async () => {
    if (!staffLink) return;

    const success = await copyToClipboard(staffLink);
    if (success) {
      setCopied(true);
      toast.success("Link copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error("Failed to copy link");
    }
  };

  const formatExpirationDate = (dateString: string | null) => {
    if (!dateString) return "";
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const title = "Staff invite link";
  const description =
    "A link that lets teachers and staff join with staff access when they sign up.";

  if (isInitializing) {
    return (
      <SettingsSection title={title} description={description}>
        <Skeleton className="h-9 w-full" />
      </SettingsSection>
    );
  }

  if (hasToken && token) {
    return (
      <SettingsSection
        title={title}
        description={description}
        status={
          isExpired ? (
            <Badge variant="warning">Expired</Badge>
          ) : (
            <Badge variant="success">Active</Badge>
          )
        }
        footerHint="Regenerating replaces the current link, which stops working."
        footer={
          <>
            <AlertDialog
              open={showRevokeAlert}
              onOpenChange={setShowRevokeAlert}
            >
              <AlertDialogTrigger
                render={
                  <Button variant="destructive-ghost" disabled={isLoading}>
                    <Trash2 />
                    Revoke
                  </Button>
                }
              />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Revoke staff link?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will invalidate the current staff invite link. Anyone
                    who hasn&apos;t used it yet won&apos;t be able to join as
                    staff. You can generate a new link afterward.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={isLoading}>
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={handleRevoke}
                    disabled={isLoading}
                  >
                    Revoke link
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button
              variant="outline"
              onClick={handleGenerate}
              disabled={isLoading}
            >
              <RefreshCw className={isLoading ? "animate-spin" : undefined} />
              Regenerate
            </Button>
          </>
        }
      >
        <Field>
          <FieldLabel htmlFor="staff-invite-link">Link</FieldLabel>
          <div className="flex items-center gap-2">
            <Input
              id="staff-invite-link"
              value={staffLink}
              readOnly
              className="font-mono"
            />
            <Button
              variant="outline"
              size="icon"
              aria-label="Copy staff invite link"
              onClick={handleCopy}
              disabled={isLoading}
            >
              {copied ? <Check className="text-success" /> : <Copy />}
            </Button>
          </div>
          <FieldDescription>
            {expiresAt
              ? `${isExpired ? "Expired" : "Expires"} ${formatExpirationDate(expiresAt)}. `
              : null}
            Anyone who signs up with this link is added with staff access.
          </FieldDescription>
        </Field>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection
      title={title}
      description={description}
      status={<Badge variant="neutral">Not generated</Badge>}
      footerHint="The link stops working after the expiration you choose."
      footer={
        <Button variant="outline" onClick={handleGenerate} disabled={isLoading}>
          <LinkIcon />
          {isLoading ? "Generating..." : "Generate link"}
        </Button>
      }
    >
      <Field>
        <FieldLabel htmlFor="expiration">Link expiration</FieldLabel>
        <Select
          value={expirationDays}
          onValueChange={(val) => val && setExpirationDays(val)}
        >
          <SelectTrigger id="expiration" className="w-full sm:w-48">
            <SelectValue placeholder="Select duration">
              {getExpirationLabel(expirationDays)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {expirationOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </SettingsSection>
  );
}
