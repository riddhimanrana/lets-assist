const DEV_DB_SOURCE_COOKIE = "la_dev_db_source";
const DEV_DB_SOURCE_STORAGE_KEY = "la-dev-db-source";

type DbSource = "local" | "remote";

type SupabaseRuntimeConfig = {
  url: string;
  publishableKey: string;
  source: DbSource;
};

function isLocalDevHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function getDefaultConfig(): SupabaseRuntimeConfig {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    source: "local",
  };
}

function getRemotePublicConfig(): { url?: string; publishableKey?: string } {
  return {
    url: process.env.NEXT_PUBLIC_REMOTE_SUPABASE_URL,
    publishableKey: process.env.NEXT_PUBLIC_REMOTE_SUPABASE_PUBLISHABLE_KEY,
  };
}

export function getBrowserSupabaseRuntimeConfig(): SupabaseRuntimeConfig {
  const fallback = getDefaultConfig();

  if (typeof window === "undefined") {
    return fallback;
  }

  if (process.env.NODE_ENV !== "development" || !isLocalDevHost(window.location.hostname)) {
    return fallback;
  }

  const selected = window.localStorage.getItem(DEV_DB_SOURCE_STORAGE_KEY);
  const wantsRemote = selected === "remote";

  if (!wantsRemote) {
    return fallback;
  }

  const remote = getRemotePublicConfig();
  if (remote.url && remote.publishableKey) {
    return {
      url: remote.url,
      publishableKey: remote.publishableKey,
      source: "remote",
    };
  }

  return fallback;
}

export function getServerSupabaseRuntimeConfig(sourceFromCookie?: string): SupabaseRuntimeConfig {
  const fallback = getDefaultConfig();

  if (process.env.NODE_ENV !== "development") {
    return fallback;
  }

  const wantsRemote = sourceFromCookie === "remote";
  if (!wantsRemote) {
    return fallback;
  }

  const remote = getRemotePublicConfig();
  if (remote.url && remote.publishableKey) {
    return {
      url: remote.url,
      publishableKey: remote.publishableKey,
      source: "remote",
    };
  }

  return fallback;
}

export function getDevDbSourceCookieName(): string {
  return DEV_DB_SOURCE_COOKIE;
}

export function getDevDbSourceStorageKey(): string {
  return DEV_DB_SOURCE_STORAGE_KEY;
}
