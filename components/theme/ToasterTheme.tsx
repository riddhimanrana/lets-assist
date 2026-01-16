"use client";

import { useTheme } from "next-themes";
import { Toaster } from "sonner";

export function ToasterTheme() {
  const { theme, systemTheme } = useTheme();
  const currentTheme = theme === "system" ? systemTheme : theme;
  return (
    <Toaster
      position="bottom-right"
      richColors
      theme={currentTheme === "dark" ? "dark" : "light"}
    />
  );
}