"use client";

import { useState, useTransition } from "react";
import { Ban, ShieldCheck, Trash2, Clock } from "lucide-react";
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
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { AccountAccessStatus } from "@/lib/auth/account-access";

import { UserSearch } from "../notifications/components/UserSearch";
import { getUserAccessControl, updateUserAccessControl, deleteAndBlacklistUser } from "../actions";

const BAN_DURATIONS: Array<{ label: string; hours: string }> = [
  { label: "1 day", hours: "24h" },
  { label: "3 days", hours: "72h" },
  { label: "1 week", hours: "168h" },
  { label: "2 weeks", hours: "336h" },
  { label: "1 month", hours: "720h" },
  { label: "3 months", hours: "2160h" },
  { label: "6 months", hours: "4380h" },
  { label: "1 year", hours: "8760h" },
  { label: "Indefinitely", hours: "876000h" },
];

type AccessControlUser = {
  id: string;
  email: string | null;
  fullName: string | null;
  username: string | null;
  bannedUntil: string | null;
  access: {
    status: AccountAccessStatus;
    reason: string | null;
    updatedAt: string | null;
    updatedBy: string | null;
  };
};

function statusBadgeVariant(status: AccountAccessStatus): "default" | "destructive" {
  if (status === "banned") return "destructive";
  return "default";
}

function formatBannedUntil(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export default function UserAccessClient() {
  const [selectedUserId, setSelectedUserId] = useState("");
  const [targetUser, setTargetUser] = useState<AccessControlUser | null>(null);
  const [status, setStatus] = useState<AccountAccessStatus>("active");
  const [banDurationEntry, setBanDurationEntry] = useState<{ label: string; hours: string }>(
    BAN_DURATIONS[BAN_DURATIONS.length - 1],
  );
  const [reason, setReason] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [sendNotification, setSendNotification] = useState(true);

  // Ban confirmation dialog
  const [banConfirmOpen, setBanConfirmOpen] = useState(false);

  // Delete & Blacklist dialog
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState("");
  const [deleteReason, setDeleteReason] = useState("");

  const [isFetchingUser, startFetchTransition] = useTransition();
  const [isSaving, startSaveTransition] = useTransition();
  const [isDeleting, startDeleteTransition] = useTransition();

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

  const doSave = () => {
    if (!selectedUserId) {
      toast.error("Select a user first.");
      return;
    }

    if (status === "banned" && reason.trim().length === 0) {
      toast.error("A reason is required when banning a user.");
      return;
    }

    startSaveTransition(async () => {
      const result = await updateUserAccessControl({
        userId: selectedUserId,
        status,
        reason,
        banDurationLabel: status === "banned" ? banDurationEntry.label.toLowerCase() : undefined,
        banDurationHours: status === "banned" ? banDurationEntry.hours : undefined,
        sendEmail,
        sendNotification,
      });

      if (result.error || !result.data) {
        toast.error(result.error || "Failed to update user access.");
        return;
      }

      const updated = result.data;
      setTargetUser((prev): AccessControlUser | null =>
        prev
          ? {
              ...prev,
              bannedUntil: updated.bannedUntil ?? null,
              access: {
                status: updated.status,
                reason: updated.reason,
                updatedAt: updated.updatedAt,
                updatedBy: prev.access.updatedBy,
              },
            }
          : prev,
      );

      setReason(updated.reason ?? "");
      toast.success(
        updated.status === "active"
          ? "User access restored."
          : `User banned${banDurationEntry.label !== "Indefinitely" ? ` for ${banDurationEntry.label.toLowerCase()}` : " indefinitely"}.`,
      );
    });
  };

  const doDeleteAndBlacklist = () => {
    if (!selectedUserId) return;

    startDeleteTransition(async () => {
      const result = await deleteAndBlacklistUser({
        userId: selectedUserId,
        reason: deleteReason,
        sendEmail,
      });

      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success("User data deleted and email blacklisted.");
      setSelectedUserId("");
      setTargetUser(null);
      setStatus("active");
      setReason("");
      setDeleteReason("");
      setDeleteConfirmInput("");
    });
  };

  const handleSaveClick = () => {
    if (status === "banned") {
      if (reason.trim().length === 0) {
        toast.error("A reason is required before banning.");
        return;
      }
      setBanConfirmOpen(true);
    } else {
      doSave();
    }
  };

  const isBusy = isFetchingUser || isSaving || isDeleting;
  const displayName = targetUser?.fullName || targetUser?.username || "this user";
  const deleteEmailMatch =
    deleteConfirmInput.trim().toLowerCase() === (targetUser?.email ?? "").toLowerCase();

  return (
    <div className="space-y-6">
      {/* Ban confirmation dialog */}
      <AlertDialog open={banConfirmOpen} onOpenChange={setBanConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ban {displayName}?</AlertDialogTitle>
            <AlertDialogDescription>
              {banDurationEntry.label === "Indefinitely"
                ? `This will indefinitely ban ${displayName} from signing in. Their data is preserved and the ban can be lifted at any time.`
                : `This will ban ${displayName} for ${banDurationEntry.label.toLowerCase()}. Their data is preserved and the ban will expire automatically.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {reason ? (
            <p className="text-sm font-medium">Reason: {reason}</p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setBanConfirmOpen(false);
                doSave();
              }}
            >
              Yes, ban user
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete & Blacklist confirmation dialog */}
      <AlertDialog
        open={deleteConfirmOpen}
        onOpenChange={(open) => {
          setDeleteConfirmOpen(open);
          if (!open) setDeleteConfirmInput("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">
              Permanently delete &amp; blacklist {displayName}?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
                <span className="block">
                  This will <strong>permanently delete all of their data</strong> (projects,
                  sign-ups, certificates, org memberships, etc.) and{" "}
                  <strong>blacklist their email address</strong> so they can never create a new
                  account with it.
                </span>
                <span className="block font-medium text-destructive">This cannot be undone.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Reason (optional)</Label>
              <Textarea
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                placeholder="Why are you permanently removing this user?"
                className="min-h-20"
              />
            </div>
            <div className="space-y-2">
              <Label>
                Type{" "}
                <span className="font-mono font-bold">{targetUser?.email}</span>{" "}
                to confirm
              </Label>
              <Input
                value={deleteConfirmInput}
                onChange={(e) => setDeleteConfirmInput(e.target.value)}
                placeholder="Enter email address to confirm"
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={!deleteEmailMatch || isDeleting}
              onClick={() => {
                setDeleteConfirmOpen(false);
                doDeleteAndBlacklist();
              }}
            >
              {isDeleting ? "Deleting..." : "Delete & blacklist"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* User selector */}
      <div className="space-y-2">
        <Label>Select user</Label>
        <UserSearch onSelect={fetchUserState} selectedUserId={selectedUserId} />
      </div>

      {/* Current user state */}
      {targetUser ? (
        <div className="rounded-lg border bg-muted/20 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium">
                {targetUser.fullName || targetUser.username || "User"}
              </p>
              <p className="text-sm text-muted-foreground">
                {targetUser.email || targetUser.id}
              </p>
            </div>
            <Badge variant={statusBadgeVariant(targetUser.access.status)}>
              Current: {targetUser.access.status === "banned" ? "Banned" : "Active"}
            </Badge>
          </div>
          {targetUser.access.reason ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Current reason: {targetUser.access.reason}
            </p>
          ) : null}
          {targetUser.bannedUntil ? (
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              Ban expires: {formatBannedUntil(targetUser.bannedUntil)}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Access level selection */}
      <div className="space-y-3">
        <Label>Access level</Label>
        <RadioGroup
          value={status}
          onValueChange={(value) => setStatus(value as AccountAccessStatus)}
          className="grid gap-3 sm:grid-cols-2"
          disabled={!targetUser || isBusy}
        >
          <Label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-muted/40">
            <RadioGroupItem value="active" className="mt-0.5" />
            <div>
              <div className="flex items-center gap-1 font-medium">
                <ShieldCheck className="h-4 w-4 text-emerald-600" /> Active
              </div>
              <p className="text-xs text-muted-foreground">Restore sign-in access</p>
            </div>
          </Label>

          <Label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-muted/40">
            <RadioGroupItem value="banned" className="mt-0.5" />
            <div>
              <div className="flex items-center gap-1 font-medium">
                <Ban className="h-4 w-4 text-destructive" /> Banned
              </div>
              <p className="text-xs text-muted-foreground">Block sign-in (data kept)</p>
            </div>
          </Label>
        </RadioGroup>

        {status === "active" && targetUser?.access.status === "banned" && (
          <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300">
            This will lift the ban so the user can sign in again.
          </p>
        )}

        {/* Ban duration picker */}
        {status === "banned" && (
          <div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
            <Clock className="h-4 w-4 shrink-0 text-destructive" />
            <div className="flex flex-1 flex-wrap items-center gap-2">
              <span className="text-sm font-medium">Duration:</span>
              <Select
                value={banDurationEntry.hours}
                onValueChange={(hours) => {
                  const entry = BAN_DURATIONS.find((d) => d.hours === hours);
                  if (entry) setBanDurationEntry(entry);
                }}
                disabled={isBusy}
              >
                <SelectTrigger className="h-8 w-44 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BAN_DURATIONS.map((d) => (
                    <SelectItem key={d.hours} value={d.hours}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </div>

      {/* Reason field */}
      <div className="space-y-2">
        <Label htmlFor="moderation-reason">
          {status === "active" ? "Note (optional)" : "Reason"}
        </Label>
        <Textarea
          id="moderation-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={
            status === "active"
              ? "Optionally explain why access is being restored..."
              : "Explain why this account is being banned..."
          }
          disabled={!targetUser || isBusy}
          className="min-h-24"
        />
      </div>

      {/* Notification toggles */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Label className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">Send email</p>
            <p className="text-xs text-muted-foreground">Notify the user with a styled email</p>
          </div>
          <Switch
            checked={sendEmail}
            onCheckedChange={setSendEmail}
            disabled={!targetUser || isBusy}
          />
        </Label>

        <Label className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">In-app notification</p>
            <p className="text-xs text-muted-foreground">
              Add a message to their notification inbox
            </p>
          </div>
          <Switch
            checked={sendNotification}
            onCheckedChange={setSendNotification}
            disabled={!targetUser || isBusy}
          />
        </Label>
      </div>

      <div className="flex justify-end">
        <Button
          variant={status === "banned" ? "destructive" : "default"}
          onClick={handleSaveClick}
          disabled={!targetUser || isBusy}
        >
          {isSaving
            ? status === "banned"
              ? "Banning..."
              : "Saving..."
            : status === "banned"
              ? "Ban user"
              : "Restore access"}
        </Button>
      </div>

      {/* Danger zone — Delete & Blacklist */}
      {targetUser ? (
        <>
          <Separator />
          <div className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
            <div className="flex items-start gap-3">
              <Trash2 className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
              <div>
                <p className="font-semibold text-destructive">Delete &amp; Blacklist</p>
                <p className="text-sm text-muted-foreground">
                  Permanently delete all of this user&apos;s data and block their email from ever
                  creating a new account. This action <strong>cannot be undone</strong>.
                </p>
              </div>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setDeleteConfirmOpen(true)}
              disabled={isBusy}
            >
              Delete data &amp; blacklist email
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
