"use client";

import { useCallback, useSyncExternalStore, type ComponentProps } from "react";

import {
  homeGreetingText,
  msUntilWeekdayRefresh,
  resolveTimeZone,
  weekdayInTimeZone,
} from "./home-greeting";

function browserTimeZone() {
  try {
    return resolveTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return null;
  }
}

/**
 * The page-title greeting: "Happy <weekday>, <first name>" in the visitor's
 * own time zone, or "Hi there" until that zone is known.
 *
 * The server never guesses the day, because its clock zone is not the
 * visitor's. It renders the fallback, and the browser's zone takes over after
 * hydration. The weekday is read through `useSyncExternalStore`, so it stays
 * correct across midnight and after the tab returns from the background
 * without setting state in an effect.
 *
 * `now` and `timeZone` are for fixtures and previews. When both are given the
 * result is fixed, so the server renders it too. An invalid `timeZone` gives
 * the fallback greeting.
 */
export function HomeGreeting({
  name,
  now,
  timeZone,
  ...props
}: Omit<ComponentProps<"span">, "children"> & {
  name?: string | null;
  now?: Date | number;
  timeZone?: string;
}) {
  const fixedNow =
    now === undefined ? undefined : now instanceof Date ? now.getTime() : now;

  const subscribe = useCallback(
    (onChange: () => void) => {
      // A fixed clock never changes day.
      if (fixedNow !== undefined) return () => {};

      let timer: number | undefined;
      const disarm = () => {
        if (timer !== undefined) window.clearTimeout(timer);
        timer = undefined;
      };
      const arm = () => {
        disarm();
        if (document.hidden) return;
        const zone = timeZone === undefined ? browserTimeZone() : timeZone;
        timer = window.setTimeout(
          () => {
            onChange();
            arm();
          },
          msUntilWeekdayRefresh(Date.now(), zone) + 50,
        );
      };
      // Background tabs throttle timers and a sleeping laptop skips them, so
      // re-read the day whenever the page is shown again.
      const refresh = () => {
        onChange();
        arm();
      };

      arm();
      document.addEventListener("visibilitychange", refresh);
      window.addEventListener("pageshow", refresh);
      return () => {
        disarm();
        document.removeEventListener("visibilitychange", refresh);
        window.removeEventListener("pageshow", refresh);
      };
    },
    [fixedNow, timeZone],
  );

  const weekday = useSyncExternalStore(
    subscribe,
    () =>
      weekdayInTimeZone(
        fixedNow ?? Date.now(),
        timeZone === undefined ? browserTimeZone() : timeZone,
      ),
    () =>
      fixedNow !== undefined && timeZone !== undefined
        ? weekdayInTimeZone(fixedNow, timeZone)
        : null,
  );

  return (
    <span data-slot="home-greeting" {...props}>
      {homeGreetingText({ weekday, name })}
    </span>
  );
}
