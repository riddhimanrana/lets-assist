import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/utils/supabase/middleware';

// Paths that require authentication
const PROTECTED_PATHS = [
    '/admin',
    '/home',
    '/projects',
    '/account'
];

// Paths that logged-in users shouldn't access
const RESTRICTED_PATHS_FOR_LOGGED_IN_USERS = ['/', '/login', '/signup'];

// Function to check if a path requires authentication
function isProtectedPath(path: string) {
    return PROTECTED_PATHS.some(protectedPath => 
        path === protectedPath || path.startsWith(`${protectedPath}/`)
    );
}

export async function middleware(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    if (searchParams.get('noRedirect') === '1') {
        return NextResponse.next();
    }

    const { supabase, response } = createClient(request);
    const {
        data: { user },
    } = await supabase.auth.getUser();
    const currentPath = request.nextUrl.pathname;

    // Handle /account redirect
    if (currentPath === '/account') {
        return NextResponse.redirect(new URL('/account/profile', request.url));
    }

    // Redirect authenticated users trying to access restricted paths
    if (user && RESTRICTED_PATHS_FOR_LOGGED_IN_USERS.includes(currentPath)) {
        return NextResponse.redirect(new URL('/home', request.url));
    }

    // Redirect non-authenticated users trying to access protected paths
    if (!user && isProtectedPath(currentPath)) {
        return NextResponse.redirect(new URL('/login', request.url));
    }

    // Allow access to all other paths
    return response;
}

export const config = {
    matcher: [
        '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ],
};
