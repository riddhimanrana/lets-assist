"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { User } from "@supabase/supabase-js";

export default function DemoClientComponent() {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    async function getUser() {
      const supabase = createClient();

      const { data, error } = await supabase.auth.getUser();
      if (error || !data?.user) {
        console.log("Error getting user:", error);
      } else {
        setUser(data.user);
      }
    }
    getUser();
  }, []);
  return (
    <div>
      <h1>Supabase Client</h1>
      <pre>{JSON.stringify(user, null, 2)}</pre>
    </div>
  );
}
