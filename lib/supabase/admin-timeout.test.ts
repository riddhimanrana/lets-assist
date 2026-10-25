import { expect, test } from "bun:test";
import { getAdminClient } from "./admin";

test("bounded admin requests preserve caller cancellation and add a timeout", async () => {
  const originalFetch = globalThis.fetch;
  const oldUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SECRET_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://synthetic.example.test";
  process.env.SUPABASE_SECRET_KEY = "synthetic-placeholder-key";
  const seen: AbortSignal[] = [];
  globalThis.fetch = Object.assign(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal) seen.push(init.signal);
      return new Response("[]", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  try {
    const caller = new AbortController();
    const client = getAdminClient({ timeoutMs: 30 });
    await client.from("synthetic").select("id").abortSignal(caller.signal);
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toBe(caller.signal);
    expect(seen[0].aborted).toBe(false);
    caller.abort();
    expect(seen[0].aborted).toBe(true);
    await client.from("synthetic").select("id");
    expect(seen).toHaveLength(2);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(seen[1].aborted).toBe(true);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = oldKey;
  }
});
