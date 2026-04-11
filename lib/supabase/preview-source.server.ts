import { cookies, headers } from "next/headers";
import {
  DEV_PREVIEW_SOURCE_COOKIE,
  type DevPreviewSource,
} from "@/lib/supabase/preview-source";

function isLocalDevHost(host: string): boolean {
  const hostname = host.split(":")[0]?.toLowerCase() ?? "";
  return hostname === "localhost" || hostname === "127.0.0.1";
}

export async function getServerPreviewSource(): Promise<DevPreviewSource> {
  if (process.env.NODE_ENV !== "development") {
    return "local";
  }

  const host = (await headers()).get("host") ?? "";
  if (!isLocalDevHost(host)) {
    return "local";
  }

  const source = (await cookies()).get(DEV_PREVIEW_SOURCE_COOKIE)?.value;
  return source === "remote" ? "remote" : "local";
}
