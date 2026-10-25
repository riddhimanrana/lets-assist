import { NextResponse } from "next/server";
import { getActiveProjects } from "../../home/actions";
import { parseProjectDiscoveryQuery } from "@/lib/projects/discovery-query";

// export const runtime = "edge"; // run on edge runtime - incompatible with cacheComponents

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = parseProjectDiscoveryQuery(searchParams);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid project search parameters" },
      { status: 400 },
    );
  }
  const { limit, offset, status, searchTerm, eventType } = parsed.data;
  try {
    const projects = await getActiveProjects(
      limit,
      offset,
      status,
      undefined,
      undefined,
      { searchTerm, eventType },
    );
    return NextResponse.json(projects);
  } catch {
    return NextResponse.json(
      { error: "Projects are temporarily unavailable. Please try again." },
      { status: 503 },
    );
  }
}
