"use client";

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

/** The confirmations for unlinking the sheet and removing the Google account. */
export function SheetDisconnectDialogs({
  unlinkOpen,
  onUnlinkOpenChange,
  unlinkIntent,
  unlinking,
  onUnlink,
  accountOpen,
  onAccountOpenChange,
  disconnectingAccount,
  onDisconnectAccount,
}: {
  unlinkOpen: boolean;
  onUnlinkOpenChange: (open: boolean) => void;
  unlinkIntent: "unlink" | "switch";
  unlinking: boolean;
  onUnlink: () => void;
  accountOpen: boolean;
  onAccountOpenChange: (open: boolean) => void;
  disconnectingAccount: boolean;
  onDisconnectAccount: () => void;
}) {
  return (
    <>
      <AlertDialog open={unlinkOpen} onOpenChange={onUnlinkOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {unlinkIntent === "switch"
                ? "Switch spreadsheet destination?"
                : "Unlink Google Sheet?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {unlinkIntent === "switch"
                ? "This will unlink the current sheet destination while keeping your Google account connected. You can choose a new destination right after."
                : "This will stop all automatic sync jobs and disconnect the organization from this spreadsheet. The spreadsheet itself will not be deleted from your Google Drive."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={unlinking}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(e) => {
                e.preventDefault();
                onUnlink();
              }}
              disabled={unlinking}
            >
              {unlinking
                ? "Unlinking..."
                : unlinkIntent === "switch"
                  ? "Unlink and switch"
                  : "Unlink sheet"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={accountOpen} onOpenChange={onAccountOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove the connected Google account?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will disconnect the Google account from this organization and
              remove the sheet sync configuration. You&apos;ll need to connect
              another Google account to resume automatic spreadsheet updates.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnectingAccount}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(e) => {
                e.preventDefault();
                onDisconnectAccount();
              }}
              disabled={disconnectingAccount}
            >
              {disconnectingAccount ? "Removing..." : "Remove account"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
