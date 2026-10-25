// Run-scoped memory only. Never persist cookies/tokens or sign out seeded actors.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const refuse = (reason) => {
  throw Error(reason);
};

export function createCaptureSessions({ createClient, password, actorLimit }) {
  if (
    typeof createClient !== "function" ||
    typeof password !== "string" ||
    password.length < 16 ||
    /[\r\n]/u.test(password) ||
    !Number.isInteger(actorLimit) ||
    actorLimit < 1 ||
    actorLimit > 22
  )
    refuse("Exact fictional session configuration required");
  const sessions = new Map();
  let disposed = false;

  async function signIn(actor) {
    const jar = new Map();
    const client = createClient({
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) {
          if (value) jar.set(name, value);
          else jar.delete(name);
        }
      },
    });
    try {
      const signed = await client.auth.signInWithPassword({
        email: actor.email,
        password,
      });
      const token = signed.data?.session?.access_token;
      if (
        signed.error ||
        signed.data?.user?.id !== actor.id ||
        typeof token !== "string" ||
        !token ||
        !jar.size
      )
        refuse("Exact fictional sign-in failed");
      return { client, token, jar };
    } catch {
      refuse("Exact fictional sign-in failed");
    }
  }

  return {
    async get(actor) {
      if (
        disposed ||
        !actor ||
        actor.kind !== "baseline" ||
        !UUID.test(actor.id) ||
        typeof actor.email !== "string" ||
        !actor.email
      )
        refuse("Exact fictional session actor required");
      let cached = sessions.get(actor.id);
      if (cached && cached.email !== actor.email)
        refuse("Fictional session identity changed");
      if (!cached) {
        if (sessions.size >= actorLimit)
          refuse("Fictional session actor bound exceeded");
        // Reserve before awaiting so simultaneous modes cannot duplicate a login.
        cached = { email: actor.email, pending: signIn(actor) };
        sessions.set(actor.id, cached);
      }
      const session = await cached.pending;
      if (disposed) refuse("Fictional capture sessions disposed");
      try {
        // Validate this exact JWT anew; never refresh, retry or weaken a denial.
        const verified = await session.client.auth.getUser(session.token);
        if (verified.error || verified.data?.user?.id !== actor.id || disposed)
          refuse("Fresh fictional identity failed");
      } catch {
        refuse("Fresh fictional identity failed");
      }
      return {
        accessToken: session.token,
        cookies: [...session.jar].map(([name, value]) => ({ name, value })),
      };
    },
    dispose() {
      disposed = true;
      sessions.clear();
      password = null;
    },
  };
}
