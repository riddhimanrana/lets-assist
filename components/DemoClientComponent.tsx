"use client";

import { useAuth } from "@/hooks/useAuth";

export default function DemoClientComponent() {
  const { user } = useAuth();

  return (
    <div>
      <h1>Supabase Client</h1>
      <pre>{JSON.stringify(user, null, 2)}</pre>
    </div>
  );
}
