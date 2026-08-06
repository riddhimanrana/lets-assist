"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  DEV_PREVIEW_SOURCE_COOKIE,
  DEV_PREVIEW_SOURCE_STORAGE_KEY,
} from "@/lib/supabase/preview-source";

type PreviewSource = "local" | "remote";

export function useDevPreviewSource() {
  const [source, setSource] = useState<PreviewSource>("local");
  const isLocalDevHost = useMemo(() => {
    if (typeof window === "undefined") return false;
    const host = window.location.hostname;
    return (
      process.env.NODE_ENV !== "production" &&
      (host === "localhost" || host === "127.0.0.1")
    );
  }, []);

  useEffect(() => {
    if (!isLocalDevHost) return;
    const savedSource = window.localStorage.getItem(
      DEV_PREVIEW_SOURCE_STORAGE_KEY,
    );
    if (savedSource === "local" || savedSource === "remote") {
      setSource(savedSource);
    }
  }, [isLocalDevHost]);

  const selectSource = useCallback((next: PreviewSource) => {
    setSource(next);
    window.localStorage.setItem(DEV_PREVIEW_SOURCE_STORAGE_KEY, next);
    document.cookie = `${DEV_PREVIEW_SOURCE_COOKIE}=${next}; Path=/; Max-Age=2592000; SameSite=Lax`;
    window.location.reload();
  }, []);

  return { source, isLocalDevHost, selectSource };
}
