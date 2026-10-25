"use client";

import { Check } from "lucide-react";

import {
  MoonIcon,
  SunIcon,
  useAnimatedIcon,
} from "@/components/icons/animated";
import { useTheme } from "@/components/theme/theme-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const themes = [
  ["light", "Light"],
  ["dark", "Dark"],
  ["system", "System"],
] as const;

/** Header theme toggle for signed-out visitors, who have no account menu. */
export function NavbarThemeMenu() {
  const { theme, setTheme } = useTheme();
  // Only one glyph is visible per theme; CSS picks it so there is no flash
  // before the stored theme hydrates.
  const sun = useAnimatedIcon();
  const moon = useAnimatedIcon();

  const start = () => {
    sun.triggerProps.onMouseEnter();
    moon.triggerProps.onMouseEnter();
  };
  const stop = () => {
    sun.triggerProps.onMouseLeave();
    moon.triggerProps.onMouseLeave();
  };

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Toggle theme"
            onMouseEnter={start}
            onMouseLeave={stop}
            onFocus={start}
            onBlur={stop}
          >
            <SunIcon
              ref={sun.ref}
              size={16}
              aria-hidden="true"
              className="dark:hidden"
            />
            <MoonIcon
              ref={moon.ref}
              size={16}
              aria-hidden="true"
              className="hidden dark:block"
            />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-36">
        {themes.map(([value, label]) => (
          <DropdownMenuItem
            key={value}
            onClick={() => setTheme(value)}
            className="justify-between"
          >
            {label}
            {theme === value ? <Check aria-hidden="true" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
