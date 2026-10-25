import { z } from "zod";

export const projectDiscoveryQuerySchema = z.object({
  limit: z.number().int().min(1).max(100).default(21),
  offset: z.number().int().min(0).max(10_000).default(0),
  status: z
    .enum(["upcoming", "in-progress", "completed", "cancelled"])
    .optional(),
  searchTerm: z.string().trim().max(200).optional(),
  eventType: z.enum(["oneTime", "multiDay", "sameDayMultiArea"]).optional(),
});

function integerParameter(value: string | null, fallback: number): number {
  return value === null ? fallback : /^\d+$/u.test(value) ? Number(value) : NaN;
}

export function parseProjectDiscoveryQuery(search: URLSearchParams) {
  return projectDiscoveryQuerySchema.safeParse({
    limit: integerParameter(search.get("limit"), 20),
    offset: integerParameter(search.get("offset"), 0),
    status: search.get("status") ?? "upcoming",
    searchTerm: search.get("search") ?? undefined,
    eventType: search.get("eventType") ?? undefined,
  });
}

export function projectSearchFilter(term: string): string {
  // PostgREST quoted values escape quotes and backslashes. The client handles
  // URL encoding; commas and parentheses here must remain part of the value.
  const pattern = JSON.stringify(`%${term}%`);
  return `title.ilike.${pattern},description.ilike.${pattern}`;
}
