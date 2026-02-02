import { createClient } from "@supabase/supabase-js";

export function getAdminClient() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const secretKey = process.env.SUPABASE_SECRET_KEY;

    if (!supabaseUrl || !secretKey) {
        throw new Error("Supabase URL and Secret Key must be defined for Admin Client.");
    }

    // Create a new client every time or cache it if desired. 
    // For admin operations, caching is usually fine but let's keep it simple.
    return createClient(supabaseUrl, secretKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    });
}
