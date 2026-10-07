"use client";

import { MonitorSmartphone, Moon, Sun } from "lucide-react";

import { useTheme } from "@/components/theme/theme-provider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const themes = [
  ["light", Sun],
  ["dark", Moon],
  ["system", MonitorSmartphone],
] as const;

type ThemeValue = (typeof themes)[number][0];

export function NavbarThemeSelector({ mobile = false }: { mobile?: boolean }) {
  const { theme, setTheme } = useTheme();

  return (
    <ToggleGroup
      variant="outline"
      size={mobile ? "default" : "sm"}
      value={[theme]}
      onValueChange={(next) => {
        // Pressing the active theme again must not leave the group empty.
        const value = next[0] as ThemeValue | undefined;
        if (value) setTheme(value);
      }}
      aria-label="Appearance"
    >
      {themes.map(([value, Icon]) => (
        <ToggleGroupItem
          key={value}
          value={value}
          aria-label={`Use ${value} theme`}
        >
          <Icon aria-hidden="true" />
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
