import { z } from "zod";
import type { createClient } from "@/lib/supabase/server";

export const BATCH_HISTORY_PAGE_SIZE = 20;
export const UNRESOLVED_BATCH_STATUSES = [
  "draft",
  "extracting",
  "review",
  "failed",
];

export type BatchHistoryRow = {
  id: string;
  schedule_id: string;
  created_at: string;
  input_method: string;
  status: string;
};

export type BatchHistoryParams = {
  mode?: string;
  batch?: string;
  draftsBefore?: string;
  historyBefore?: string;
};

const cursorSchema = z.tuple([
  z.string().datetime({ offset: true }),
  z.string().uuid(),
]);

export function readBatchHistoryCursor(value?: string) {
  const result = cursorSchema.safeParse(value?.split("|"));
  return result.success ? result.data : null;
}

export async function loadBatchHistoryPage(
  client: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
  kind: "drafts" | "history",
  before?: string,
) {
  const cursor = readBatchHistoryCursor(before);
  let query = client
    .from("project_paper_scan_batches")
    .select("id,schedule_id,created_at,input_method,status")
    .eq("project_id", projectId)
    .in("status", kind === "drafts" ? UNRESOLVED_BATCH_STATUSES : ["committed"])
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(BATCH_HISTORY_PAGE_SIZE + 1);
  if (cursor) {
    const [createdAt, id] = cursor;
    query = query.or(
      `created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id})`,
    );
  }
  const { data, error } = await query;
  if (error) throw new Error("Could not load saved attendance batches.");
  const rows = (data ?? []).slice(
    0,
    BATCH_HISTORY_PAGE_SIZE,
  ) as BatchHistoryRow[];
  const last = rows.at(-1);
  return {
    rows,
    hasCursor: cursor !== null,
    nextCursor:
      data && data.length > BATCH_HISTORY_PAGE_SIZE && last
        ? `${last.created_at}|${last.id}`
        : null,
  };
}

export function batchHistoryHref(
  projectId: string,
  params: BatchHistoryParams,
  changes: Partial<Record<keyof BatchHistoryParams, string | null>>,
) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...changes })) {
    if (typeof value === "string" && value) query.set(key, value);
  }
  return `/projects/${projectId}/paper-signups${query.size ? `?${query}` : ""}`;
}
