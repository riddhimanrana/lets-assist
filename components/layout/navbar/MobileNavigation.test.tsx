import { expect, mock, test } from "bun:test";
import {
  Children,
  cloneElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { NavbarAccount } from "./account";

// The sheet primitive owns portal/focus behavior. Render its contents here to
// check the real menu's states, destinations and handlers without opening UI.
mock.module("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetTrigger: ({ render }: { render: ReactElement }) => render,
  SheetContent: ({
    children,
    className,
  }: {
    children: ReactNode;
    className: string;
  }) => <div className={className}>{children}</div>,
  SheetClose: ({
    render,
    children,
  }: {
    render: ReactElement;
    children: ReactNode;
  }) => cloneElement(render, {}, children),
  SheetTitle: ({
    children,
    className,
  }: {
    children: ReactNode;
    className: string;
  }) => <h2 className={className}>{children}</h2>,
}));
mock.module("./NavbarThemeSelector", () => ({
  NavbarThemeSelector: () => <div aria-label="Theme choices" />,
}));
mock.module("./DevPreviewSourceSwitch", () => ({
  DevPreviewSourceSwitch: () => <div>Local preview source</div>,
}));
const { MobileNavigation } = await import("./MobileNavigation");
const account: NavbarAccount = {
  displayName: "Example Organizer",
  email: "organizer@example.test",
  avatarUrl: undefined,
  profileHref: "/profile/example",
  isProfileLoading: false,
  isLoggingOut: false,
  onLogout() {},
  onFeedback() {},
  onDonate() {},
  devPreview: { isLocalDevHost: false, source: "remote", selectSource() {} },
};
const props = {
  open: true,
  onOpenChange() {},
  isLoading: false,
  isAuthenticated: false,
  pathname: "/projects",
  account,
};
function find(
  node: ReactNode,
  predicate: (element: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>> | undefined {
  if (!node || typeof node !== "object" || !("props" in node)) return;
  const element = node as ReactElement<Record<string, unknown>>;
  if (predicate(element)) return element;
  for (const child of Children.toArray(element.props.children as ReactNode)) {
    const match = find(child, predicate);
    if (match) return match;
  }
}

test.each([false, true])(
  "menu trigger reports the actual open state (%s) without hover animation",
  (open) => {
    const html = renderToStaticMarkup(
      <MobileNavigation {...props} open={open} />,
    );
    expect(html).toContain(`aria-label="${open ? "Close menu" : "Open menu"}"`);
    expect(html).toContain(`aria-expanded="${open}"`);
    expect(html).toContain("lucide-menu");
    expect(html).not.toContain("transform-origin");
  },
);
test("guest drawer restores narrow width, stacked auth actions and spaced groups", () => {
  const html = renderToStaticMarkup(<MobileNavigation {...props} />);
  expect(html).toContain("data-[side=right]:w-[85%]");
  expect(html).toContain("motion-reduce:transition-none");
  expect(html.indexOf('href="/login"')).toBeLessThan(
    html.indexOf('href="/projects"'),
  );
  expect(html).toContain('aria-label="Features"');
  expect(html).toContain("Theme choices");
  expect(html).not.toContain("Log out");
  expect(html).not.toContain("Local preview source");
  expect(html).not.toContain("aria-[current=page]:bg-");
});
test("member drawer keeps account details, routes and pending logout state", () => {
  const html = renderToStaticMarkup(
    <MobileNavigation
      {...props}
      isAuthenticated
      account={{ ...account, isLoggingOut: true }}
    />,
  );
  expect(html).toContain("Example Organizer");
  expect(html).toContain("organizer@example.test");
  expect(html).toContain('href="/profile/example"');
  expect(html).toContain('href="/home"');
  expect(html).toContain("Logging out...");
  expect(html).not.toContain('href="/login"');
  expect(html.indexOf("Logging out...")).toBeLessThan(
    html.indexOf('href="/home"'),
  );
});
test("destination clicks close the controlled drawer", () => {
  const changes: boolean[] = [];
  const tree = MobileNavigation({
    ...props,
    onOpenChange: (open) => changes.push(open),
  });
  const link = find(tree, (element) => element.props.href === "/projects");
  expect(link).toBeDefined();
  (link!.props.onClick as () => void)();
  expect(changes).toEqual([false]);
});
test("feedback retains its action and closes the menu", () => {
  let feedback = 0;
  const changes: boolean[] = [];
  const tree = MobileNavigation({
    ...props,
    onOpenChange: (open) => changes.push(open),
    account: {
      ...account,
      onFeedback: () => {
        feedback++;
      },
    },
  });
  const row = find(
    tree,
    (element) => element.props.children === "Send feedback",
  );
  (row!.props.onClick as () => void)();
  expect(feedback).toBe(1);
  expect(changes).toEqual([false]);
});
test("loading does not expose sign-in or member actions", () => {
  const html = renderToStaticMarkup(<MobileNavigation {...props} isLoading />);
  expect(html).toContain("Loading account");
  expect(html).not.toContain('href="/login"');
  expect(html).not.toContain('href="/home"');
});
