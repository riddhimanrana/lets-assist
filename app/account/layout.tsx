"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Bell,
  Blocks,
  Calendar,
  Menu,
  Shield,
  User,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { cn } from "@/lib/utils";

type AccountNavItem = { title: string; href: string; icon: LucideIcon };

const navGroups: Array<{ label: string; items: AccountNavItem[] }> = [
  {
    label: "Account",
    items: [
      { title: "Profile", href: "/account/profile", icon: User },
      {
        title: "Sign-in & security",
        href: "/account/security",
        icon: Shield,
      },
      { title: "Notifications", href: "/account/notifications", icon: Bell },
    ],
  },
  {
    label: "Connections",
    items: [
      { title: "Calendar", href: "/account/calendar", icon: Calendar },
      {
        title: "Organization content",
        href: "/account/plugins",
        icon: Blocks,
      },
    ],
  },
];

function isActivePath(pathname: string | null, href: string) {
  return pathname === href || Boolean(pathname?.startsWith(`${href}/`));
}

function AccountNav({
  pathname,
  size = "default",
  onNavigate,
}: {
  pathname: string | null;
  size?: "default" | "lg";
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Account settings" className="grid gap-4">
      {navGroups.map((group) => (
        <div key={group.label} className="grid gap-1">
          <p className="text-muted-foreground px-2.5 text-xs font-medium">
            {group.label}
          </p>
          {group.items.map((item) => {
            const Icon = item.icon;
            const active = isActivePath(pathname, item.href);
            return (
              <Button
                key={item.href}
                asChild
                variant="ghost"
                size={size}
                className={cn(
                  "text-muted-foreground w-full justify-start gap-2 font-normal",
                  active && "bg-muted text-foreground font-medium",
                )}
              >
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  onClick={onNavigate}
                >
                  <Icon aria-hidden="true" />
                  <span className="truncate">{item.title}</span>
                </Link>
              </Button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export default function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const pathname = usePathname();

  return (
    <div className="flex min-h-[calc(100vh-64px)] flex-col lg:flex-row">
      {/* Phone and tablet: a slim bar that opens the same nav in a drawer.
          The page keeps its own title, so the bar only names the area. */}
      <div className="bg-background sticky top-0 z-30 flex items-center gap-2 border-b px-4 py-2 lg:hidden">
        <Drawer open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
          <DrawerTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0"
              aria-label="Open settings menu"
            >
              <Menu aria-hidden="true" />
            </Button>
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader className="border-b">
              <DrawerTitle>Settings</DrawerTitle>
            </DrawerHeader>
            <div className="overflow-y-auto p-4">
              <AccountNav
                pathname={pathname}
                size="lg"
                onNavigate={() => setIsDrawerOpen(false)}
              />
            </div>
          </DrawerContent>
        </Drawer>
        <p className="text-sm font-medium">Settings</p>
      </div>

      <aside className="hidden w-60 shrink-0 border-r lg:block">
        <div className="sticky top-0 grid gap-4 p-4">
          <p className="px-2.5 text-lg font-semibold tracking-tight">
            Settings
          </p>
          <AccountNav pathname={pathname} />
        </div>
      </aside>

      {/* The one content container for every account page. Pages render a
          PageHeader and a stack of sections; they set no padding or width. */}
      <main className="min-w-0 flex-1">
        <div className="w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6">
          {children}
        </div>
      </main>
    </div>
  );
}
