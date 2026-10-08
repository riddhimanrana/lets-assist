"use client";

import Link from "next/link";
import {
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  FileText,
  MoreVertical,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { OrganizerSignup } from "./signups-format";

export type SignupSortDirection = "asc" | "desc";

const STATUS_BADGE: Record<
  OrganizerSignup["status"],
  {
    label: string;
    variant: "success" | "warning" | "destructive" | "info" | "secondary";
  }
> = {
  approved: { label: "Approved", variant: "success" },
  pending: { label: "Pending", variant: "warning" },
  rejected: { label: "Rejected", variant: "destructive" },
  attended: { label: "Attended", variant: "info" },
  cancelled: { label: "Cancelled", variant: "secondary" },
};

/** One slot's signups. Row actions sit on the right edge, always in one place. */
export function SignupsTable({
  signups,
  showComments,
  showWaiver,
  statusSort,
  onToggleStatusSort,
  processing,
  unrejecting,
  waiverDownloads,
  onReject,
  onUnreject,
  onViewResponses,
  onViewWaiver,
  onDownloadWaiver,
}: {
  signups: OrganizerSignup[];
  showComments: boolean;
  showWaiver: boolean;
  statusSort: SignupSortDirection;
  onToggleStatusSort: () => void;
  processing: Record<string, boolean>;
  unrejecting: Record<string, boolean>;
  waiverDownloads: Record<string, boolean>;
  onReject: (signupId: string) => void;
  onUnreject: (signupId: string) => void;
  onViewResponses: (signup: OrganizerSignup) => void;
  onViewWaiver: (signup: OrganizerSignup) => void;
  onDownloadWaiver: (signupId: string) => void;
}) {
  const SortIcon = statusSort === "asc" ? ChevronUp : ChevronDown;

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Contact</TableHead>
            {showComments && <TableHead>Comment</TableHead>}
            {showWaiver && <TableHead>Waiver</TableHead>}
            <TableHead
              aria-sort={statusSort === "asc" ? "ascending" : "descending"}
            >
              <Button
                variant="ghost"
                className="-ml-2.5"
                onClick={onToggleStatusSort}
              >
                Status
                <SortIcon data-icon="inline-end" aria-hidden="true" />
              </Button>
            </TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {signups.map((signup) => {
            const isRegistered = !!signup.user_id;
            const name = isRegistered
              ? signup.profile?.full_name
              : signup.anonymous_signup?.name;
            const email = isRegistered
              ? signup.profile?.email
              : signup.anonymous_signup?.email;
            const phone = isRegistered
              ? signup.profile?.phone
              : signup.anonymous_signup?.phone_number;
            const username = isRegistered ? signup.profile?.username : null;
            const waiverSignature = Array.isArray(signup.waiver_signature)
              ? signup.waiver_signature[0]
              : signup.waiver_signature;
            const multiSignerCount =
              waiverSignature?.signature_summary?.signerCount ??
              waiverSignature?.signature_payload?.signers?.length ??
              0;
            const status = STATUS_BADGE[signup.status];

            return (
              <TableRow key={signup.id}>
                <TableCell className="font-medium">{name || "N/A"}</TableCell>
                <TableCell>
                  {isRegistered ? (
                    <Link
                      href={`/profile/${username}`}
                      className="underline-offset-4 hover:underline"
                    >
                      Registered user
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">Anonymous</span>
                  )}
                </TableCell>
                <TableCell>
                  <div>{email || "No email"}</div>
                  {phone && (
                    <div className="text-muted-foreground text-sm">
                      {phone.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3") ||
                        "No phone"}
                    </div>
                  )}
                </TableCell>
                {showComments && (
                  <TableCell className="text-muted-foreground max-w-50 text-sm">
                    {signup.volunteer_comment ? (
                      <div className="max-h-15 overflow-y-auto text-wrap wrap-break-word whitespace-pre-wrap">
                        {signup.volunteer_comment}
                      </div>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                )}
                {showWaiver && (
                  <TableCell>
                    {waiverSignature ? (
                      <div className="flex items-center gap-1">
                        <Badge variant="success">
                          Signed
                          {multiSignerCount > 1 && ` (${multiSignerCount})`}
                        </Badge>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button variant="ghost" size="icon">
                                <span className="sr-only">Open menu</span>
                                <MoreVertical aria-hidden="true" />
                              </Button>
                            }
                          />
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => onViewWaiver(signup)}
                            >
                              <Eye aria-hidden="true" />
                              View waiver
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => onDownloadWaiver(signup.id)}
                            >
                              {waiverSignature?.id &&
                              waiverDownloads[waiverSignature.id] ? (
                                <Spinner />
                              ) : (
                                <Download aria-hidden="true" />
                              )}
                              Download PDF
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    ) : (
                      <Badge variant="warning">Missing</Badge>
                    )}
                  </TableCell>
                )}
                <TableCell>
                  <Badge variant={status.variant}>{status.label}</Badge>
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    {signup.response_data && (
                      <Button
                        variant="ghost"
                        onClick={() => onViewResponses(signup)}
                      >
                        <FileText data-icon="inline-start" aria-hidden="true" />
                        Responses
                      </Button>
                    )}
                    {signup.status === "rejected" ? (
                      <Button
                        variant="outline"
                        onClick={() => onUnreject(signup.id)}
                        disabled={unrejecting[signup.id]}
                      >
                        {unrejecting[signup.id] ? (
                          <>
                            <Spinner data-icon="inline-start" />
                            Approving...
                          </>
                        ) : (
                          "Unreject"
                        )}
                      </Button>
                    ) : (
                      <Button
                        variant="destructive-ghost"
                        onClick={() => onReject(signup.id)}
                        disabled={processing[signup.id]}
                      >
                        {processing[signup.id] ? (
                          <>
                            <Spinner data-icon="inline-start" />
                            Rejecting...
                          </>
                        ) : (
                          "Reject"
                        )}
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
