"use server";
import { createClient } from "@/utils/supabase/server";
import { revalidatePath } from "next/cache";

export async function logout() {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  
  // Instead of redirecting, return success or error
  if (error) {
    return { success: false, error: error.message };
  } else {
    revalidatePath("/", "layout");
    return { success: true };
  }
}
