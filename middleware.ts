import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/middleware";

// Paths that require authentication
const PROTECTED_PATHS = ["/admin", "/home", "/projects/create", "/account"];

// Paths that logged-in users shouldn't access
const RESTRICTED_PATHS_FOR_LOGGED_IN_USERS = ["/", "/login", "/signup", "/projects"];

// Function to check if a path requires authentication
function isProtectedPath(path: string) {
  return PROTECTED_PATHS.some(
    (protectedPath) =>
      path === protectedPath || path.startsWith(`${protectedPath}/`),
  );
}

// Function to check if path is for project creator only
function isProjectCreatorPath(path: string) {
  const matches = path.match(/^\/projects\/([^\/]+)\/(edit|signups|documents)$/);
  return matches ? { isCreatorPath: true, projectId: matches[1] } : { isCreatorPath: false, projectId: null };
}

export async function middleware(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  if (searchParams.get("noRedirect") === "1") {
    return NextResponse.next();
  }

  const { supabase, response } = createClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const currentPath = request.nextUrl.pathname;

  // Handle /account redirect - must come first as it's a simple path redirect
  if (currentPath === "/account") {
    return NextResponse.redirect(new URL("/account/profile", request.url));
  }

  // Redirect authenticated users trying to access restricted paths
  if (user && RESTRICTED_PATHS_FOR_LOGGED_IN_USERS.includes(currentPath)) {
    return NextResponse.redirect(new URL("/home", request.url));
  }

  // Redirect non-authenticated users trying to access protected paths
  if (!user && isProtectedPath(currentPath)) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Check for project creator routes
  const { isCreatorPath, projectId } = isProjectCreatorPath(currentPath);
  if (isCreatorPath && projectId) {
    // If not logged in, redirect to login with return URL
    if (!user) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('redirect', request.nextUrl.pathname);
      return NextResponse.redirect(loginUrl);
    }

    // Check if user is the project creator
    const { data: project } = await supabase
      .from("projects")
      .select("creator_id")
      .eq("id", projectId)
      .single();

    if (!project || project.creator_id !== user.id) {
      // If not creator, redirect back to project page
      return NextResponse.redirect(
        new URL(`/projects/${projectId}`, request.url)
      );
    }
  }

  // Allow access to all other paths
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
