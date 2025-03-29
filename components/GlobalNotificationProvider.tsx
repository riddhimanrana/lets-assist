"use client";

import { createClient } from "@/utils/supabase/client";
import { useEffect, useState, useRef } from "react";
import { NotificationListener } from "./NotificationListener";

export default function GlobalNotificationProvider({ 
  children 
}: { 
  children: React.ReactNode 
}) {
  const [userId, setUserId] = useState<string | null>(null);
  const initRef = useRef(false);
  
  useEffect(() => {
    
    console.log('Initializing GlobalNotificationProvider');
    const supabase = createClient();
    
    // Get the current user and set up the notification listener
    const getUserId = async () => {
      try {
        const { data: { user }, error } = await supabase.auth.getUser();
        if (error) {
          // Ignore error if session missing
          if (error.message.toLowerCase().includes("auth session missing")) {
            setUserId(null);
          } else {
            console.error("Auth error in notification provider:", error);
            setUserId(null);
          }
          return;
        }
        if (user) {
          console.log("Found authenticated user:", user.id);
          setUserId(user.id);
        } else {
          console.log("No authenticated user found");
          setUserId(null);
        }
      } catch (err) {
        console.error("Error in getUserId:", err);
        setUserId(null);
      }
    };
    
    getUserId();
    
    // Listen for auth state changes
    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        console.log(`Auth state changed: ${event}`);
        const user = session?.user;
        if (event === 'SIGNED_IN' && user) {
          console.log("User signed in:", user.id);
          setUserId(user.id);
        } else if (event === 'SIGNED_OUT') {
          console.log("User signed out");
          setUserId(null);
        }
      }
    );
    
    return () => {
      console.log("Cleaning up auth listener");
      authListener?.subscription.unsubscribe();
    };
  }, []); // Empty dependency array is correct as this should only run once
  
  return (
    <>
      {userId && <NotificationListener userId={userId} />}
      {children}
    </>
  );
}
