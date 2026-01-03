"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { 
  Copy, 
  RefreshCw, 
  Trash2, 
  Clock, 
  Link as LinkIcon,
  Check,
  Users
} from "lucide-react";
import { toast } from "sonner";
import { generateStaffLink, revokeStaffLink, getStaffLinkDetails } from "./actions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

interface StaffLinkDisplayProps {
  organizationId: string;
  organizationUsername: string;
}

export default function StaffLinkDisplay({ 
  organizationId, 
  organizationUsername 
}: StaffLinkDisplayProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [_isExpired, setIsExpired] = useState(false);
  void _isExpired;
  const [expirationDays, setExpirationDays] = useState("30");
  const [copied, setCopied] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);

  // Get base URL for the staff link
  const baseUrl = typeof window !== 'undefined' 
    ? `${window.location.origin}/signup`
    : '';

  const staffLink = token 
    ? `${baseUrl}?staff_token=${token}&org=${organizationUsername}`
    : '';

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
      const result = await generateStaffLink(organizationId, parseInt(expirationDays));
      
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
    }
  };

  const handleCopy = async () => {
    if (!staffLink) return;
    
    try {
      await navigator.clipboard.writeText(staffLink);
      setCopied(true);
      toast.success("Link copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy link");
    }
  };

  const formatExpirationDate = (dateString: string | null) => {
    if (!dateString) return "";
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  if (isInitializing) {
    return (
      <div className="flex items-center justify-center py-8">
        <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {hasToken && token ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="gap-1">
              <Users className="h-3 w-3" />
              Staff Link Active
            </Badge>
            {expiresAt && (
              <Badge variant="outline" className="gap-1">
                <Clock className="h-3 w-3" />
                Expires {formatExpirationDate(expiresAt)}
              </Badge>
            )}
          </div>

          <div className="flex gap-2">
            <Input 
              value={staffLink}
              readOnly
              className="font-mono text-sm"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={handleCopy}
              disabled={isLoading}
            >
              {copied ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>

          <p className="text-sm text-muted-foreground">
            Share this link with teachers or staff members. They will be automatically 
            added to your organization with staff-level access when they sign up.
          </p>

          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleGenerate}
              disabled={isLoading}
              className="gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              Regenerate Link
            </Button>
            
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  disabled={isLoading}
                  className="gap-2"
                >
                  <Trash2 className="h-4 w-4" />
                  Revoke Link
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Revoke Staff Link?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will invalidate the current staff invite link. Anyone who 
                    hasn't used it yet won't be able to join as staff. You can 
                    generate a new link afterward.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleRevoke}>
                    Revoke Link
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <Label htmlFor="expiration">Link Expiration</Label>
              <Select 
                value={expirationDays} 
                onValueChange={setExpirationDays}
              >
                <SelectTrigger id="expiration" className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">7 days</SelectItem>
                  <SelectItem value="30">30 days</SelectItem>
                  <SelectItem value="90">90 days</SelectItem>
                  <SelectItem value="365">1 year</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            onClick={handleGenerate}
            disabled={isLoading}
            className="gap-2"
          >
            <LinkIcon className="h-4 w-4" />
            {isLoading ? "Generating..." : "Generate Staff Invite Link"}
          </Button>

          <p className="text-sm text-muted-foreground">
            Generate a special link that allows teachers or staff members to join 
            your organization directly with staff-level access.
          </p>
        </div>
      )}
    </div>
  );
}
