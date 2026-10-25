import "server-only";
import { safeConsole } from "@/lib/safe-console";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { drainPublicationEmails } from "@/lib/projects/hours-publication-email-service";
import {
  isTransactionalPublication,
  publishVolunteerHoursTransaction,
  type TransactionalPublication,
} from "@/lib/projects/hours-publication-service";

const MAX_SESSIONS = 10; // Sessions claimed per run
const MAX_SESSION_ENTRIES = 1000; // The atomic publication input bound
const RECOVERY_DELIVERY_LIMIT = 25; // Email deliveries attempted per run

// Create a Supabase client for server-side operations without cookies
function createServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase service credentials are required.");
  }

  return createClient(supabaseUrl, supabaseKey);
}

type ServiceClient = ReturnType<typeof createServiceClient>;

// Types specific to auto-publish functionality
export interface AutoPublishResult {
  success: boolean;
  projectId: string;
  sessionId: string;
  sessionName: string;
  certificatesCreated: number;
  deliveriesQueued: number;
  errors: string[];
}

export type AutoPublishApproval =
  | { status: "approved"; approvedFrom: string }
  | { status: "approval_required"; reason: "missing" | "invalid" | "future" };

export type HeldSessionCounts = {
  historical: number;
  oversized: number;
  invalidAttendance: number;
  missingCreator: number;
  invalidSchedule: number;
};

export type AutoPublishDiscovery = {
  // False when no count was taken. The counts are then null, not zero.
  counted: boolean;
  contended: boolean;
  pendingSessions: number | null;
  heldSessions: HeldSessionCounts | null;
};

export type AutoPublishRecovery = {
  // The database counted every relevant ledger in the claim statement.
  // pending is work still owed after this run's selection. held is work that
  // will not be sent automatically. Null only when nothing was counted.
  counted: boolean;
  pending: number | null;
  held: number | null;
  // The deliveries selected by this run. accepted is provider acceptance the
  // ledger recorded, and partial is every other selected delivery.
  deliveries: number;
  accepted: number;
  partial: number;
  settlementUnconfirmed: number;
};

export type AutoPublishRun = {
  approvalStatus: AutoPublishApproval["status"];
  // Top-level copies of discovery.counted and discovery.heldSessions. The
  // shared worker monitoring reads these two names.
  discoveryCounted: boolean;
  heldSessions: HeldSessionCounts | null;
  processedSessions: number;
  successfulSessions: number;
  // Present only when discovery counted the eligible sessions it left behind.
  pendingSessions?: number;
  discovery: AutoPublishDiscovery;
  recovery: AutoPublishRecovery;
  results: AutoPublishResult[];
};

type ClaimedEntry = {
  signupId: string;
  checkIn: string;
  checkOut: string;
  attendanceRevision: number;
};

type ClaimedSession = {
  projectId: string;
  publishKey: string;
  creatorId: string;
  projectTitle: string;
  entries: ClaimedEntry[];
};

type RecoveryGroup = {
  projectId: string;
  publication: TransactionalPublication;
};

type RecoveryClaim = {
  groups: RecoveryGroup[];
  pending: number;
  held: number;
};

const APPROVED_FROM_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/**
 * AUTO_PUBLISH_APPROVED_FROM is the operator's explicit lower bound for
 * automatic publication. It must be a complete UTC instant ending in Z. There
 * is no default: a missing, malformed, overflowing, or future value approves
 * nothing.
 */
export function resolveAutoPublishApproval(
  raw: string | undefined,
  now: Date = new Date(),
): AutoPublishApproval {
  if (raw === undefined || raw === "") {
    return { status: "approval_required", reason: "missing" };
  }
  if (!APPROVED_FROM_PATTERN.test(raw)) {
    return { status: "approval_required", reason: "invalid" };
  }

  const instant = new Date(raw);
  const [seconds, fraction = ""] = raw.slice(0, -1).split(".");
  const canonical = `${seconds}.${fraction.padEnd(3, "0")}Z`;
  // A calendar overflow such as February 30 parses to a different instant.
  if (Number.isNaN(instant.getTime()) || instant.toISOString() !== canonical) {
    return { status: "approval_required", reason: "invalid" };
  }
  if (instant.getTime() > now.getTime()) {
    return { status: "approval_required", reason: "future" };
  }
  return { status: "approved", approvedFrom: canonical };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function parseClaimedSession(value: unknown): ClaimedSession | null {
  if (
    !isRecord(value) ||
    typeof value.projectId !== "string" ||
    typeof value.publishKey !== "string" ||
    typeof value.creatorId !== "string" ||
    typeof value.projectTitle !== "string" ||
    !Array.isArray(value.entries)
  ) {
    return null;
  }

  const entries: ClaimedEntry[] = [];
  for (const entry of value.entries) {
    if (
      !isRecord(entry) ||
      typeof entry.signupId !== "string" ||
      typeof entry.checkIn !== "string" ||
      typeof entry.checkOut !== "string" ||
      !isCount(entry.attendanceRevision)
    ) {
      return null;
    }
    entries.push({
      signupId: entry.signupId,
      checkIn: entry.checkIn,
      checkOut: entry.checkOut,
      attendanceRevision: entry.attendanceRevision,
    });
  }

  return {
    projectId: value.projectId,
    publishKey: value.publishKey,
    creatorId: value.creatorId,
    projectTitle: value.projectTitle,
    entries,
  };
}

function parseHeldSessions(value: unknown): HeldSessionCounts | null {
  if (
    !isRecord(value) ||
    !isCount(value.historical) ||
    !isCount(value.oversized) ||
    !isCount(value.invalidAttendance) ||
    !isCount(value.missingCreator) ||
    !isCount(value.invalidSchedule)
  ) {
    return null;
  }
  return {
    historical: value.historical,
    oversized: value.oversized,
    invalidAttendance: value.invalidAttendance,
    missingCreator: value.missingCreator,
    invalidSchedule: value.invalidSchedule,
  };
}

function parseClaim(
  value: unknown,
): { sessions: ClaimedSession[]; discovery: AutoPublishDiscovery } | null {
  if (!isRecord(value) || !Array.isArray(value.sessions)) return null;
  if (value.contended === true) {
    return {
      sessions: [],
      discovery: {
        counted: false,
        contended: true,
        pendingSessions: null,
        heldSessions: null,
      },
    };
  }

  const heldSessions = parseHeldSessions(value.heldSessions);
  if (
    value.contended !== false ||
    value.counted !== true ||
    !isCount(value.pendingSessions) ||
    !heldSessions ||
    value.sessions.length > MAX_SESSIONS
  ) {
    return null;
  }

  const sessions: ClaimedSession[] = [];
  for (const candidate of value.sessions) {
    const session = parseClaimedSession(candidate);
    if (!session) return null;
    sessions.push(session);
  }
  return {
    sessions,
    discovery: {
      counted: true,
      contended: false,
      pendingSessions: value.pendingSessions,
      heldSessions,
    },
  };
}

// The claim is an inventory: the selected groups plus exact counts of what
// is still owed and what is held. A claim without both counts is refused
// rather than read as zero.
function parseRecoveryClaim(value: unknown): RecoveryClaim | null {
  if (
    !isRecord(value) ||
    value.counted !== true ||
    !isCount(value.pendingDeliveries) ||
    !isCount(value.heldDeliveries) ||
    !Array.isArray(value.groups) ||
    value.groups.length > RECOVERY_DELIVERY_LIMIT
  ) {
    return null;
  }
  const groups: RecoveryGroup[] = [];
  let deliveries = 0;
  for (const candidate of value.groups) {
    if (
      !isRecord(candidate) ||
      typeof candidate.projectId !== "string" ||
      !isTransactionalPublication(candidate.publication) ||
      candidate.publication.deliveries.length === 0
    ) {
      return null;
    }
    for (const delivery of candidate.publication.deliveries) {
      if (
        !isRecord(delivery) ||
        typeof delivery.deliveryId !== "string" ||
        typeof delivery.certificateId !== "string" ||
        typeof delivery.idempotencyKey !== "string" ||
        typeof delivery.state !== "string"
      ) {
        return null;
      }
    }
    deliveries += candidate.publication.deliveries.length;
    groups.push({
      projectId: candidate.projectId,
      publication: candidate.publication,
    });
  }
  if (deliveries > RECOVERY_DELIVERY_LIMIT) return null;
  return {
    groups,
    pending: value.pendingDeliveries,
    held: value.heldDeliveries,
  };
}

function autoPublicationRequestKey(
  projectId: string,
  sessionId: string,
  entries: ClaimedEntry[],
) {
  const digest = createHash("sha256")
    .update(JSON.stringify({ projectId, sessionId, entries }))
    .digest("hex");
  return `hours-publication:v1:${digest}`;
}

function failedSession(
  session: ClaimedSession,
  sessionName: string,
  error: string,
): AutoPublishResult {
  return {
    success: false,
    projectId: session.projectId,
    sessionId: session.publishKey,
    sessionName,
    certificatesCreated: 0,
    deliveriesQueued: 0,
    errors: [error],
  };
}

// Publish certificates, notifications, email work, and the session flag in the
// same replay-safe database transaction used by the organizer workflow. Email
// is not sent here: the committed work is drained by the bounded sweep.
async function processSessionSignups(
  session: ClaimedSession,
): Promise<AutoPublishResult> {
  const project = {
    id: session.projectId,
    creator_id: session.creatorId,
    title: session.projectTitle,
  };
  const sessionId = session.publishKey;
  const sessionName = `${project.title} - ${sessionId}`;

  try {
    if (session.entries.length === 0) {
      return failedSession(
        session,
        sessionName,
        "No valid volunteer hours data to publish",
      );
    }
    // The claim never returns more than the publication bound on purpose. A
    // larger snapshot is held whole; publishing a slice would drop volunteers.
    if (session.entries.length > MAX_SESSION_ENTRIES) {
      return failedSession(
        session,
        sessionName,
        "Session exceeds 1,000 attendance entries and is held for organizer review",
      );
    }

    const requestKey = autoPublicationRequestKey(
      project.id,
      sessionId,
      session.entries,
    );
    const transaction = await publishVolunteerHoursTransaction({
      actorId: project.creator_id,
      projectId: project.id,
      scheduleId: sessionId,
      entries: session.entries,
      requestKey,
      origin: "automatic",
      claimedSnapshot: true,
    });

    if (!transaction.publication) {
      return failedSession(
        session,
        sessionName,
        transaction.invalidResponse
          ? "Atomic publication returned an invalid receipt"
          : transaction.errorCode === "PT409"
            ? "Attendance changed after the claim; publication was refused (PT409)"
            : `Atomic publication failed${transaction.errorCode ? ` (${transaction.errorCode})` : ""}`,
      );
    }

    const publication = transaction.publication;
    return {
      success: true,
      projectId: project.id,
      sessionId,
      sessionName,
      certificatesCreated: publication.certificatesCreated,
      deliveriesQueued: publication.deliveries.filter((delivery) =>
        ["queued", "retryable_failure", "processing"].includes(delivery.state),
      ).length,
      errors: [],
    };
  } catch (error: unknown) {
    safeConsole.error("Unexpected error in processSessionSignups:", error);
    return failedSession(
      session,
      sessionName,
      "An unexpected server error occurred",
    );
  }
}

// Discovery, validation, fair ordering, and the attempt record all happen in
// one database transaction. The service never pages attendance rows itself.
async function claimDueSessions(
  supabase: ServiceClient,
  approvedFrom: string,
): Promise<{ sessions: ClaimedSession[]; discovery: AutoPublishDiscovery }> {
  const { data, error } = await supabase.rpc("claim_due_hours_publications", {
    p_approved_from: approvedFrom,
    p_limit: MAX_SESSIONS,
  });
  if (error) {
    safeConsole.error(
      "Error fetching eligible signups:",
      error.code ?? "unknown",
    );
    throw new Error("Eligible signup query unavailable");
  }

  const claim = parseClaim(data);
  if (!claim) {
    throw new Error("Eligible signup query returned an invalid claim");
  }
  return claim;
}

// Drain committed email work that is still pending, whichever run or request
// created it. The ledger decides what is safe: accepted, skipped, definitive,
// and unknown outcomes are never returned and never resent. The claim also
// reports what it left behind, so a full batch is never mistaken for an
// empty queue.
async function recoverPublicationEmails(
  supabase: ServiceClient,
): Promise<AutoPublishRecovery> {
  const { data, error } = await supabase.rpc(
    "claim_hours_publication_email_recovery",
    { p_limit: RECOVERY_DELIVERY_LIMIT },
  );
  if (error) {
    safeConsole.error(
      "Application diagnostic from app/api/cron/auto-publish-hours/route",
      `Email recovery claim failed (${error.code ?? "unknown"})`,
    );
    throw new Error("Publication email recovery query unavailable");
  }

  const claim = parseRecoveryClaim(data);
  if (!claim) {
    throw new Error("Publication email recovery returned an invalid claim");
  }

  const { groups } = claim;
  const recovery: AutoPublishRecovery = {
    counted: true,
    pending: claim.pending,
    held: claim.held,
    deliveries: 0,
    accepted: 0,
    partial: 0,
    settlementUnconfirmed: 0,
  };
  for (const group of groups) {
    const deliveries = group.publication.deliveries.length;
    recovery.deliveries += deliveries;
    try {
      const summary = await drainPublicationEmails(group.publication);
      const accepted = Math.min(summary.settledAccepted, deliveries);
      recovery.accepted += accepted;
      recovery.partial += deliveries - accepted;
      recovery.settlementUnconfirmed += summary.settlementUnconfirmed;
    } catch (error: unknown) {
      // The ledger keeps every claimed delivery. Nothing here is reported as
      // sent, and the next sweep decides again from the recorded state.
      recovery.partial += deliveries;
      safeConsole.error(
        "Application diagnostic from app/api/cron/auto-publish-hours/route",
        "Email recovery drain failed",
        error,
      );
    }
  }
  return recovery;
}

// Main function: publish explicitly approved sessions whose latest checkout is
// at least 48 hours old, then sweep pending certificate email.
export async function processExpiredSessions(): Promise<AutoPublishRun> {
  try {
    const supabase = createServiceClient();
    safeConsole.log("Starting auto-publish process...");

    const approval = resolveAutoPublishApproval(
      process.env.AUTO_PUBLISH_APPROVED_FROM,
    );
    let discovery: AutoPublishDiscovery = {
      counted: false,
      contended: false,
      pendingSessions: null,
      heldSessions: null,
    };
    const results: AutoPublishResult[] = [];
    let successfulSessions = 0;

    if (approval.status === "approved") {
      const claim = await claimDueSessions(supabase, approval.approvedFrom);
      discovery = claim.discovery;

      for (const session of claim.sessions) {
        const result = await processSessionSignups(session);
        results.push(result);
        if (result.success) successfulSessions++;
      }
    } else {
      // No boundary means no new publication and no discovery, so there is no
      // honest count of what is waiting.
      safeConsole.log(
        "Application diagnostic from app/api/cron/auto-publish-hours/route",
        `New publication requires AUTO_PUBLISH_APPROVED_FROM (${approval.reason})`,
      );
    }

    // Email for a committed receipt was approved when that receipt was
    // written, so the sweep does not depend on the boundary above.
    const recovery = await recoverPublicationEmails(supabase);

    safeConsole.log(
      "Application diagnostic from app/api/cron/auto-publish-hours/route",
      `Auto-publish process completed: ${successfulSessions}/${results.length} sessions published, ${recovery.accepted}/${recovery.deliveries} recovered deliveries accepted`,
    );

    return {
      approvalStatus: approval.status,
      discoveryCounted: discovery.counted,
      heldSessions: discovery.heldSessions,
      processedSessions: results.length,
      successfulSessions,
      ...(discovery.pendingSessions === null
        ? {}
        : { pendingSessions: discovery.pendingSessions }),
      discovery,
      recovery,
      results,
    };
  } catch (error: unknown) {
    safeConsole.error("Error in processExpiredSessions:", error);
    throw error;
  }
}
