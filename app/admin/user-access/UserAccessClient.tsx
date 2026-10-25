"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { SettingsSection } from "@/components/layout/SettingsSection";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { AccountAccessStatus } from "@/lib/auth/account-access";

import { statusTone } from "../components/admin-status";
import { UserSearch } from "../notifications/components/UserSearch";
import {
  getUserAccessControl,
  updateUserAccessControl,
  deleteAndBlacklistUser,
} from "../actions";
import { BanConfirmDialog, DeleteConfirmDialog } from "./UserAccessDialogs";

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
  const [banDurationEntry, setBanDurationEntry] = useState<{
    label: string;
    hours: string;
  }>(BAN_DURATIONS[BAN_DURATIONS.length - 1]);
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
        banDurationLabel:
          status === "banned"
            ? banDurationEntry.label.toLowerCase()
            : undefined,
        banDurationHours:
          status === "banned" ? banDurationEntry.hours : undefined,
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
      if (result.warning) toast.warning(result.warning);
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

      toast.success("Personal account records removed and email blacklisted.");
      if (result.warning) toast.warning(result.warning);
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
  const displayName =
    targetUser?.fullName || targetUser?.username || "this user";
  const deleteEmailMatch =
    deleteConfirmInput.trim().toLowerCase() ===
    (targetUser?.email ?? "").toLowerCase();

  return (
    <>
      <BanConfirmDialog
        open={banConfirmOpen}
        onOpenChange={setBanConfirmOpen}
        displayName={displayName}
        durationLabel={banDurationEntry.label}
        reason={reason}
        onConfirm={() => {
          setBanConfirmOpen(false);
          doSave();
        }}
      />
      <DeleteConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={(open) => {
          setDeleteConfirmOpen(open);
          if (!open) setDeleteConfirmInput("");
        }}
        displayName={displayName}
        email={targetUser?.email ?? null}
        reason={deleteReason}
        onReasonChange={setDeleteReason}
        confirmInput={deleteConfirmInput}
        onConfirmInputChange={setDeleteConfirmInput}
        canConfirm={deleteEmailMatch && !isDeleting}
        isDeleting={isDeleting}
        onConfirm={() => {
          setDeleteConfirmOpen(false);
          doDeleteAndBlacklist();
        }}
      />

      <SettingsSection
        title="Account moderation"
        footerHint={
          targetUser ? undefined : "Select a user to change their access."
        }
        footer={
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
        }
      >
        <FieldGroup className="gap-6">
          <Field>
            <FieldLabel>Select user</FieldLabel>
            <UserSearch
              onSelect={fetchUserState}
              selectedUserId={selectedUserId}
            />
          </Field>

          {targetUser ? (
            <div className="grid gap-1 border-y py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {targetUser.fullName || targetUser.username || "User"}
                  </p>
                  <p className="text-muted-foreground truncate text-sm">
                    {targetUser.email || targetUser.id}
                  </p>
                </div>
                <Badge variant={statusTone(targetUser.access.status)}>
                  Current:{" "}
                  {targetUser.access.status === "banned" ? "Banned" : "Active"}
                </Badge>
              </div>
              {targetUser.access.reason ? (
                <p className="text-muted-foreground mt-2 text-sm">
                  Current reason: {targetUser.access.reason}
                </p>
              ) : null}
              {targetUser.bannedUntil ? (
                <p className="text-muted-foreground text-sm">
                  Ban expires: {formatBannedUntil(targetUser.bannedUntil)}
                </p>
              ) : null}
            </div>
          ) : null}

          <FieldSet>
            <FieldLegend variant="label">Access level</FieldLegend>
            <RadioGroup
              value={status}
              onValueChange={(value) => setStatus(value as AccountAccessStatus)}
              className="grid gap-3 sm:grid-cols-2"
              disabled={!targetUser || isBusy}
            >
              <Field orientation="horizontal">
                <RadioGroupItem value="active" id="access-active" />
                <FieldContent>
                  <FieldLabel htmlFor="access-active">Active</FieldLabel>
                  <FieldDescription>Restore sign-in access</FieldDescription>
                </FieldContent>
              </Field>
              <Field orientation="horizontal">
                <RadioGroupItem value="banned" id="access-banned" />
                <FieldContent>
                  <FieldLabel htmlFor="access-banned">Banned</FieldLabel>
                  <FieldDescription>Block sign-in (data kept)</FieldDescription>
                </FieldContent>
              </Field>
            </RadioGroup>

            {status === "active" && targetUser?.access.status === "banned" && (
              <Alert variant="info">
                <AlertDescription>
                  This will lift the ban so the user can sign in again.
                </AlertDescription>
              </Alert>
            )}
          </FieldSet>

          {status === "banned" && (
            <Field>
              <FieldLabel htmlFor="ban-duration">Duration</FieldLabel>
              <Select
                value={banDurationEntry.hours}
                onValueChange={(hours) => {
                  const entry = BAN_DURATIONS.find((d) => d.hours === hours);
                  if (entry) setBanDurationEntry(entry);
                }}
                disabled={isBusy}
              >
                <SelectTrigger id="ban-duration" className="w-full sm:w-56">
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
            </Field>
          )}

          <Field>
            <FieldLabel htmlFor="moderation-reason">
              {status === "active" ? "Note (optional)" : "Reason"}
            </FieldLabel>
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
          </Field>

          <div className="grid gap-4">
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="access-send-email">Send email</FieldLabel>
                <FieldDescription>
                  Notify the user with a styled email
                </FieldDescription>
              </FieldContent>
              <Switch
                id="access-send-email"
                checked={sendEmail}
                onCheckedChange={setSendEmail}
                disabled={!targetUser || isBusy}
              />
            </Field>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="access-send-notification">
                  In-app notification
                </FieldLabel>
                <FieldDescription>
                  Add a message to their notification inbox
                </FieldDescription>
              </FieldContent>
              <Switch
                id="access-send-notification"
                checked={sendNotification}
                onCheckedChange={setSendNotification}
                disabled={!targetUser || isBusy}
              />
            </Field>
          </div>
        </FieldGroup>
      </SettingsSection>

      {targetUser ? (
        <SettingsSection
          tone="danger"
          title="Delete & blacklist"
          description={
            <>
              Permanently delete all of this user&apos;s data and block their
              email from ever creating a new account. This action{" "}
              <strong>cannot be undone</strong>.
            </>
          }
          footer={
            <Button
              variant="destructive"
              onClick={() => setDeleteConfirmOpen(true)}
              disabled={isBusy}
            >
              Delete data &amp; blacklist email
            </Button>
          }
        />
      ) : null}
    </>
  );
}
