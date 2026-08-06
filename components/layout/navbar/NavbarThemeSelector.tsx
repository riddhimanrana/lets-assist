"use client";

import { MonitorSmartphone, Moon, Sun } from "lucide-react";

import { useTheme } from "@/components/theme/theme-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const themes = [
  ["light", Sun],
  ["dark", Moon],
  ["system", MonitorSmartphone],
] as const;

export function NavbarThemeSelector({ mobile = false }: { mobile?: boolean }) {
  const { theme, setTheme } = useTheme();
  const size = mobile ? "h-8 w-8" : "h-6 w-6";
  const iconSize = mobile ? "h-4 w-4" : "h-3 w-3";

  return (
    <div
      className={cn(
        "relative flex items-center border rounded-lg space-x-1",
        mobile ? "p-1" : "p-0.5",
      )}
    >
      {themes.map(([value, Icon]) => (
        <Button
          key={value}
          variant="ghost"
          size="icon"
          className={cn(
            "relative z-10 flex items-center justify-center rounded-md",
            size,
            theme === value && "text-primary bg-accent",
          )}
          onClick={() => setTheme(value)}
          aria-label={`Use ${value} theme`}
        >
          <Icon className={iconSize} />
        </Button>
      ))}
    </div>
  );
}
