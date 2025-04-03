import { NextResponse } from "next/server";
import { getActiveProjects } from "../../home/actions";
import type { ProjectStatus } from "@/types";

export const runtime = "edge"; // run on edge runtime

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get("limit") || "20", 10);
  const offset = parseInt(searchParams.get("offset") || "0", 10);
  const status = (searchParams.get("status") || "upcoming") as ProjectStatus; // Default to upcoming projects
  
  // Pass status parameter to getActiveProjects function
  const projects = await getActiveProjects(limit, offset, status);
  return NextResponse.json(projects);
}