import { NextResponse } from "next/server";
import { getActiveProjects } from "../../home/actions";
import type { Project, ProjectStatus } from "@/types";

// export const runtime = "edge"; // run on edge runtime - incompatible with cacheComponents

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get("limit") || "20", 10);
  const offset = parseInt(searchParams.get("offset") || "0", 10);
  const status = (searchParams.get("status") || "upcoming") as ProjectStatus; // Default to upcoming projects
  const searchTerm = searchParams.get("search")?.trim() || undefined;
  const eventType = searchParams.get("eventType")?.trim() || undefined;

  const projects = await getActiveProjects(limit, offset, status, undefined, undefined, {
    searchTerm,
    eventType: eventType as Project["event_type"] | undefined,
  });

  return NextResponse.json(projects);
}