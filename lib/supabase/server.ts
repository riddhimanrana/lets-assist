/**
 * Server-side Supabase client for Server Components, Server Actions, and Route Handlers.
 *
 * ## Auth Guidelines (per Supabase Issue #40985)
 *
 * **DO NOT** call `supabase.auth.getUser()` or `supabase.auth.getSession()` directly.
 * Instead, use the auth helpers from `@/lib/supabase/auth-helpers`:
 *
 * ```typescript
 * import { getAuthUser, requireAuth } from "@/lib/supabase/auth-helpers";
 *
 * // For most operations (uses getClaims, fast):
 * const { user } = await getAuthUser();
 *
 * // For sensitive ops like password change (uses getUser, secure):
 * const { user } = await getAuthUser({ sensitive: true });
 *
 * // Or use requireAuth() which throws if not authenticated:
 * const user = await requireAuth();
 * ```
 *
 * @see /lib/supabase/auth-helpers.ts for the recommended auth patterns
 * @see https://github.com/supabase/supabase/issues/40985 for context
 */

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
    const cookieStore = await cookies();

    return createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        {
            cookies: {
                getAll() {
                    return cookieStore.getAll();
                },
                setAll(cookiesToSet) {
                    try {
                        cookiesToSet.forEach(({ name, value, options }) =>
                            cookieStore.set(name, value, options)
                        );
                    } catch {
                        // The `setAll` method was called from a Server Component.
                        // This can be ignored if you have middleware refreshing
                        // user sessions.
                    }
                },
            },
        }
    );
}
