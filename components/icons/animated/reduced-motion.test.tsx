import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { MouseEvent, ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const start = mock((_variant: string) => Promise.resolve());
mock.module("motion/react", () => ({
  useAnimation: () => ({ start }),
  motion: new Proxy({}, { get: () => () => null }),
}));

const { BellIcon } = await import("./bell");
const { useAnimatedIcon } = await import("./use-animated-icon");

type HoverProps = {
  onMouseEnter: (event: MouseEvent<HTMLDivElement>) => void;
  onMouseLeave: (event: MouseEvent<HTMLDivElement>) => void;
};
type IconRender = (props: { size?: number }, ref: null) => ReactElement;

const globals = globalThis as { window?: unknown };
const originalWindow = globals.window;
function setReducedMotion(reduce: boolean) {
  globals.window = {
    matchMedia: (query: string) => ({
      matches: reduce && query === "(prefers-reduced-motion: reduce)",
    }),
  };
}

/**
 * Renders the icon with no ref, which is the uncontrolled path, and returns
 * the hover handlers it put on its wrapper.
 */
function renderUncontrolledBell() {
  let hover: HoverProps | undefined;
  function Harness() {
    const element = (BellIcon as unknown as { render: IconRender }).render(
      { size: 16 },
      null,
    );
    hover = element.props as HoverProps;
    return element;
  }
  renderToStaticMarkup(<Harness />);
  if (!hover) throw new Error("The icon did not render");
  return hover;
}

const hoverEvent = {} as MouseEvent<HTMLDivElement>;

beforeEach(() => start.mockClear());
afterAll(() => {
  globals.window = originalWindow;
  mock.restore();
});

describe("animated icons and reduced motion", () => {
  test("an uncontrolled icon stays static on hover when reduced motion is on", () => {
    setReducedMotion(true);
    const hover = renderUncontrolledBell();
    hover.onMouseEnter(hoverEvent);
    expect(start).not.toHaveBeenCalledWith("animate");
    hover.onMouseLeave(hoverEvent);
    expect(start).not.toHaveBeenCalledWith("animate");
  });

  test("an uncontrolled icon still plays on hover without the preference", () => {
    setReducedMotion(false);
    const hover = renderUncontrolledBell();
    hover.onMouseEnter(hoverEvent);
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith("animate");
  });

  test("the controlling hook skips the animation for reduced motion", () => {
    const startAnimation = mock(() => {});
    let icon: ReturnType<typeof useAnimatedIcon> | undefined;
    function Harness() {
      icon = useAnimatedIcon();
      return null;
    }
    renderToStaticMarkup(<Harness />);
    if (!icon) throw new Error("The hook did not render");
    icon.ref.current = { startAnimation, stopAnimation: () => {} };

    setReducedMotion(true);
    icon.triggerProps.onMouseEnter();
    expect(startAnimation).not.toHaveBeenCalled();
    setReducedMotion(false);
    icon.triggerProps.onMouseEnter();
    expect(startAnimation).toHaveBeenCalledTimes(1);
  });

  test("every icon file guards its own hover handler with the shared check", () => {
    const directory = import.meta.dir;
    const iconFiles = readdirSync(directory).filter(
      (file) => file.endsWith(".tsx") && !file.includes(".test."),
    );
    expect(iconFiles.length).toBeGreaterThan(60);

    const unguarded = iconFiles.filter((file) => {
      const source = readFileSync(join(directory, file), "utf8");
      const enter = source.match(
        /const handleMouseEnter = useCallback\(([\s\S]*?)\n\s*\);/u,
      )?.[1];
      return !(
        source.includes(
          'import { prefersReducedMotion } from "./use-animated-icon";',
        ) &&
        enter?.includes("!prefersReducedMotion()") &&
        // No second, file-local media query that could drift from the helper.
        !source.includes("matchMedia")
      );
    });
    expect(unguarded).toEqual([]);
  });
});
