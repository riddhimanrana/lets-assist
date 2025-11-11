import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

// Paths that require authentication
const PROTECTED_PATHS = ["/home", "/projects/create", "/account"];

// Paths that logged-in users shouldn't access
const RESTRICTED_PATHS_FOR_LOGGED_IN_USERS = ["/", "/login", "/signup", "/reset-password"];

// Function to check if a path requires authentication
function isProtectedPath(path: string) {
  return PROTECTED_PATHS.some(
    (protectedPath) =>
      path === protectedPath || path.startsWith(`${protectedPath}/`),
  );
}

// Function to check if path is for project creator only
function isProjectCreatorPath(path: string) {
  const matches = path.match(/^\/projects\/([^\/]+)\/(edit|signups|documents|attendance|hours)$/);
  return matches ? { isCreatorPath: true, projectId: matches[1] } : { isCreatorPath: false, projectId: null };
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // CRITICAL: Always refresh the session to sync server-side auth changes to cookies
  // This ensures that after login, the session is immediately available to the client
  // The session refresh is quick and necessary for the SSR auth flow to work properly
  const { data: { user: refreshedUser } } = await supabase.auth.getUser();
  
  // Check for ?noRedirect=1 query parameter
  const searchParams = request.nextUrl.searchParams;
  if (searchParams.get("noRedirect") === "1") {
    return supabaseResponse; // Skip redirects if requested
  }

  const currentPath = request.nextUrl.pathname;
  let user = refreshedUser;


// Handle /account redirect - must come first as it's a simple path redirect
  if (currentPath === "/account") {
    return NextResponse.redirect(new URL("/account/profile", request.url));
  }

  // Handle reset password paths specially
  if (currentPath.startsWith("/reset-password")) {
    // Always clear any existing session for reset password flow
    if (user) {
      await supabase.auth.signOut();
      // Create a new response to clear cookies
      const response = NextResponse.redirect(request.url);
      response.cookies.delete('sb-access-token');
      response.cookies.delete('sb-refresh-token');
      return response;
    }
    // Let them continue to the reset password flow
    return supabaseResponse;
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

  // Handle admin routes - redirect to 404 if not super admin
  if (currentPath.startsWith("/admin")) {
    if (!user) {
      // Not logged in, redirect to not-found to avoid leaking the route
      return NextResponse.redirect(new URL("/not-found", request.url));
    }
    // Logged-in users proceed; the admin route performs a service-role check server-side.
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
    try {
      const { data: project, error } = await supabase
        .from("projects")
        .select("creator_id")
        .eq("id", projectId)
        .single();

      if (error) {
        console.error("Error fetching project for creator check:", error);
        // Redirect to a generic error page or home page might be appropriate
        return NextResponse.redirect(new URL("/home", request.url));
      }

      if (!project || project.creator_id !== user.id) {
        // If not creator, redirect back to project page
        return NextResponse.redirect(
          new URL(`/projects/${projectId}`, request.url)
        );
      }
    } catch (e) {
      console.error("Exception during project creator check:", e);
      return NextResponse.redirect(new URL("/home", request.url));
    }
  }

  // If no redirects were triggered, return the response that updates the session cookie
  return supabaseResponse;
}
