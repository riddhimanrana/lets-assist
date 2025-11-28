import { NextResponse } from "next/server";
import { getActiveProjects } from "../../home/actions";
import { createClient } from "@/utils/supabase/server";
import type { ProjectStatus } from "@/types";

export const runtime = "edge"; // run on edge runtime

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get("limit") || "20", 10);
  const offset = parseInt(searchParams.get("offset") || "0", 10);
  const status = (searchParams.get("status") || "upcoming") as ProjectStatus; // Default to upcoming projects
  
  // Get current user to check permissions
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  // Pass user and status parameters to getActiveProjects function
  const projects = await getActiveProjects(limit, offset, status, undefined, user?.id);
  return NextResponse.json(projects);
}