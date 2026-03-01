"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Ban, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { AccountAccessStatus } from "@/lib/auth/account-access";

import { UserSearch } from "../notifications/components/UserSearch";
import { getUserAccessControl, updateUserAccessControl } from "../actions";

type AccessControlUser = {
  id: string;
  email: string | null;
  fullName: string | null;
  username: string | null;
  access: {
    status: AccountAccessStatus;
    reason: string | null;
    updatedAt: string | null;
    updatedBy: string | null;wa sd
  };
};

function formatStatusLabel(status: AccountAccessStatus) {
  if (status === "restricted") return "Restricted";
  if (status === "banned") return "Banned";
  return "Active";a aa
}

function statusBadgeVariant(status: AccountAccessStatus): "default" | "secondary" | "destructive" {
  if (status === "banned") return "destructive";
  if (status === "restricted") return "secondary";
  return "default";
}

function getStatusHelp(status: AccountAccessStatus) {
  if (status === "banned") {
    return "User cannot sign in or access the platform.";
  }
  if (status === "restricted") {
    return "User cannot sign in until the restriction is lifted.";
  }
  return "Full access restored.";
}

export default function UserAccessClient() {
  const [selectedUserId, setSelectedUserId] = useState("");
  const [targetUser, setTargetUser] = useState<AccessControlUser | null>(null);
  const [status, setStatus] = useState<AccountAccessStatus>("active");
  const [reason, setReason] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [sendNotification, setSendNotification] = useState(true);
  const [isFetchingUser, startFetchTransition] = useTransition();
  const [isSaving, startSaveTransition] = useTransition();

  const fetchUserState = (userId: string) => {
    if (!userId) {
      setSelectedUserId("");
      setTargetUser(null);
      setStatus("active");
      setReason("");
      return;
    }

    setSelectedUserId(userId);

    startFetchTransition(async () => {
      const result = await getUserAccessControl(userId);
      if (result.error || !result.data) {
        toast.error(result.error || "Unable to load user access settings.");
        return;
      }

      setTargetUser(result.data);
      setStatus(result.data.access.status);
      setReason(result.data.access.reason ?? "");
    });
  };

  const handleSave = () => {
    if (!selectedUserId) {
      toast.error("Select a user first.");
      return;
    }

    if (status !== "active" && reason.trim().length === 0) {
      toast.error("A reason is required when restricting or banning a user.");
      return;
    }

    startSaveTransition(async () => {
      const result = await updateUserAccessControl({
        userId: selectedUserId,
        status,
        reason,
        sendEmail,
        sendNotification,
      });

      if (result.error || !result.data) {
        toast.error(result.error || "Failed to update user access.");
        return;
      }

      const updated = result.data;
      setTargetUser((previous) =>
        previous
          ? {
              ...previous,
              access: {
                status: updated.status,
                reason: updated.reason,
                updatedAt: updated.updatedAt,
                updatedBy: previous.access.updatedBy,
              },
            }
          : previous,
      );

      setReason(updated.reason ?? "");

      toast.success(`User status updated to ${formatStatusLabel(updated.status)}.`);
    });
  };

  const isBusy = isFetchingUser || isSaving;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label>Select user</Label>
        <UserSearch
          onSelect={fetchUserState}
          selectedUserId={selectedUserId}
        />
      </div>

      {targetUser ? (
        <div className="rounded-lg border bg-muted/20 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium">{targetUser.fullName || targetUser.username || "User"}</p>
              <p className="text-sm text-muted-foreground">{targetUser.email || targetUser.id}</p>
            </div>
            <Badge variant={statusBadgeVariant(targetUser.access.status)}>
              Current: {formatStatusLabel(targetUser.access.status)}
            </Badge>
          </div>
          {targetUser.access.reason ? (
            <p className="mt-3 text-sm text-muted-foreground">Current reason: {targetUser.access.reason}</p>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-3">
        <Label>Access level</Label>
        <RadioGroup
          value={status}
          onValueChange={(value) => setStatus(value as AccountAccessStatus)}
          className="grid gap-3 md:grid-cols-3"
          disabled={!targetUser || isBusy}
        >
          <Label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-muted/40">
            <RadioGroupItem value="active" className="mt-0.5" />
            <div>
              <div className="flex items-center gap-1 font-medium">
                <ShieldCheck className="h-4 w-4 text-emerald-600" /> Active
              </div>
              <p className="text-xs text-muted-foreground">Restore normal access</p>
            </div>
          </Label>

          <Label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-muted/40">
            <RadioGroupItem value="restricted" className="mt-0.5" />
            <div>
              <div className="flex items-center gap-1 font-medium">
                <AlertTriangle className="h-4 w-4 text-amber-600" /> Restricted
              </div>
              <p className="text-xs text-muted-foreground">Prevent sign-in temporarily</p>
            </div>
          </Label>

          <Label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-muted/40">
            <RadioGroupItem value="banned" className="mt-0.5" />
            <div>
              <div className="flex items-center gap-1 font-medium">
                <Ban className="h-4 w-4 text-destructive" /> Banned
              </div>
              <p className="text-xs text-muted-foreground">Block all sign-in access</p>
            </div>
          </Label>
        </RadioGroup>
        <p className="text-xs text-muted-foreground">{getStatusHelp(status)}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="moderation-reason">Reason</Label>
        <Textarea
          id="moderation-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Explain why this account status is being applied..."
          disabled={!targetUser || isBusy}
          className="min-h-24"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Label className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">Send email</p>
            <p className="text-xs text-muted-foreground">Notify the user with a styled email template</p>
          </div>
          <Switch
            checked={sendEmail}
            onCheckedChange={setSendEmail}
            disabled={!targetUser || isBusy}
          />
        </Label>

        <Label className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">Create in-app notification</p>
            <p className="text-xs text-muted-foreground">Add a message to the user&apos;s notification inbox</p>
          </div>
          <Switch
            checked={sendNotification}
            onCheckedChange={setSendNotification}
            disabled={!targetUser || isBusy}
          />
        </Label>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={!targetUser || isBusy}>
          {isSaving ? "Saving..." : "Update account access"}
        </Button>
      </div>
    </div>
  );
}
