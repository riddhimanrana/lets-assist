"use client";

import { useCallback, useState } from "react";

import {
  buildReportsGoogleSheetPicker,
  type GoogleApiWindow,
  type PickerCallbackData,
} from "../google-picker";
import { getSheetsAccessTokenForPicker } from "../sheets-actions";

function loadGoogleApi() {
  const win = window as unknown as GoogleApiWindow;
  if (win.gapi?.load) return Promise.resolve(true);

  return new Promise<boolean>((resolve, reject) => {
    const existing = document.querySelector(
      'script[data-google-picker="true"]',
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(true));
      existing.addEventListener("error", () =>
        reject(new Error("Failed to load Google API")),
      );
      return;
    }

    const script = document.createElement("script");
    script.src = "https://apis.google.com/js/api.js";
    script.async = true;
    script.defer = true;
    script.dataset.googlePicker = "true";
    script.onload = () => resolve(true);
    script.onerror = () => reject(new Error("Failed to load Google API"));
    document.body.appendChild(script);
  });
}

/**
 * Opens the Google picker for one spreadsheet. Picking a file is what gives
 * the connected Google account access to it, so every flow that needs a
 * spreadsheet goes through here.
 */
export function useSheetPicker({
  organizationId,
  onPicked,
  onError,
}: {
  organizationId: string;
  onPicked: (sheetId: string) => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [pickerReady, setPickerReady] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const pickerApiKey = process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY;

  const initPicker = useCallback(async () => {
    const win = window as unknown as GoogleApiWindow;
    if (win.google?.picker) {
      setPickerReady(true);
      return true;
    }

    try {
      await loadGoogleApi();
    } catch {
      return false;
    }

    return await new Promise<boolean>((resolve) => {
      win.gapi?.load("picker", {
        callback: () => {
          setPickerReady(true);
          resolve(true);
        },
      });
    });
  }, []);

  const openPicker = async () => {
    setPickerLoading(true);

    try {
      const tokenResult = await getSheetsAccessTokenForPicker(organizationId);
      if (!tokenResult.success) {
        onError(
          tokenResult.error || "Unable to open Google Picker. Try again.",
        );
        return;
      }

      if (!pickerApiKey) {
        onError(
          "Google Picker is not configured. Missing NEXT_PUBLIC_GOOGLE_PICKER_API_KEY.",
        );
        return;
      }

      if (!(await initPicker())) {
        onError("Unable to load Google Picker library.");
        return;
      }

      const google = (window as unknown as GoogleApiWindow).google;
      if (!google?.picker) {
        onError("Google Picker is not available.");
        return;
      }

      const view = new google.picker.DocsView(
        google.picker.ViewId.SPREADSHEETS,
      );
      view.setMimeTypes("application/vnd.google-apps.spreadsheet");

      const picker = buildReportsGoogleSheetPicker({
        builder: new google.picker.PickerBuilder(),
        title: "Select a Google Sheet",
        view,
        accessToken: tokenResult.accessToken,
        developerKey: pickerApiKey,
        pickerAppId: tokenResult.pickerAppId,
        callback: (data: PickerCallbackData) => {
          if (data.action !== google.picker.Action.PICKED) return;
          const sheetId = data.docs?.[0]?.id;
          if (sheetId) void onPicked(sheetId);
        },
      });

      picker.setVisible(true);
    } finally {
      setPickerLoading(false);
    }
  };

  return { pickerReady, pickerLoading, openPicker };
}
