'use server';

import { cookies } from 'next/headers';
import { z } from 'zod'; // Import Zod for validation

/**
 * Server action to set the scan cookie
 * This separates cookie manipulation into a server action as required by Next.js
 */
export async function setScanCookie(
  projectId: string, 
  scheduleId: string, 
  data: { scanId: string; timestamp: string; userAgent: string }
) {
  const cookieStore = await cookies();
  
  // Set scan cookie with 3 hour expiration
  cookieStore.set(`scan_${projectId}_${scheduleId}`, JSON.stringify(data), {
    maxAge: 60 * 60 * 3, // 3 hours
    path: '/',
    httpOnly: true,
    sameSite: 'strict'
  });
  
  return { success: true };
}

// Schema for validating input to the server action
const SetCookieSchema = z.object({
  projectId: z.string().uuid(),
  sessionUuid: z.string().uuid(), // Expect sessionUuid
  scheduleId: z.string().min(1),  // Expect scheduleId
});

/**
 * Server action to set the attendance verification cookie.
 * This will be called by the client-side PrepareClient component.
 */
export async function setAttendanceCookie(
  projectId: string,
  sessionUuid: string, // Use sessionUuid
  scheduleId: string   // Use scheduleId
): Promise<{ success: boolean; error?: string }> {
  // Validate input
  const validation = SetCookieSchema.safeParse({ projectId, sessionUuid, scheduleId });
  if (!validation.success) {
    console.error("Invalid input for setAttendanceCookie:", validation.error.flatten());
    return { success: false, error: "Invalid parameters provided." };
  }

  const cookieStore = await cookies();
  // Construct cookie name consistent with AttendPage.tsx
  const cookieName = `attend_${projectId}_${sessionUuid}_${scheduleId}`;
  const cookieValue = new Date().toISOString(); // Simple timestamp value

  try {
    console.log(`[Server Action] Setting cookie: ${cookieName} with SameSite=Lax`);
    cookieStore.set({
      name: cookieName,
      value: cookieValue,
      httpOnly: true,
      path: `/attend/${projectId}`, // Path must match where it's read
      sameSite: 'lax', // Use Lax for potentially better compatibility
      maxAge: 60 * 5, // 5 minutes - short lifespan for verification
      secure: process.env.NODE_ENV === 'production',
    });
    console.log('[Server Action] Cookie set successfully:', { cookieName });
    return { success: true };
  } catch (error) {
    console.error('[Server Action] Failed to set cookie:', { cookieName, error });
    return { success: false, error: "Failed to set verification cookie." };
  }
}
