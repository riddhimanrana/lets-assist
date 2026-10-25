"use client";

import {
  useState,
  type ForwardRefExoticComponent,
  type HTMLAttributes,
  type RefAttributes,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  BellIcon,
  BlocksIcon,
  ClipboardCheckIcon,
  LayoutGridIcon,
  LayoutPanelTopIcon,
  MenuIcon,
  MessageCircleIcon,
  ShieldCheckIcon,
  SquarePenIcon,
  UserCheckIcon,
  UsersRoundIcon,
  useAnimatedIcon,
  type AnimatedIconHandle,
} from "@/components/icons/animated";
import { buttonVariants } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface AdminSidebarProps {
  activeTab?: string;
  onTabChange?: (tab: string) => void;
}

type AnimatedIcon = ForwardRefExoticComponent<
  HTMLAttributes<HTMLDivElement> & {
    size?: number;
  } & RefAttributes<AnimatedIconHandle>
>;

type NavItem = {
  id: string;
  href: string;
  label: string;
  icon: AnimatedIcon;
  exact?: boolean;
};

const navItems: NavItem[] = [
  {
    id: "overview",
    href: "/admin",
    label: "Overview",
    icon: LayoutGridIcon,
    exact: true,
  },
  {
    id: "notifications",
    href: "/admin/notifications",
    label: "Notifications",
    icon: BellIcon,
  },
  {
    id: "system-banner",
    href: "/admin/system-banner",
    label: "System banner",
    icon: LayoutPanelTopIcon,
  },
  {
    id: "user-access",
    href: "/admin/user-access",
    label: "User access",
    icon: UserCheckIcon,
  },
  {
    id: "organizations",
    href: "/admin/organizations",
    label: "Organizations",
    icon: UsersRoundIcon,
  },
  { id: "plugins", href: "/admin/plugins", label: "Plugins", icon: BlocksIcon },
  {
    id: "feedback",
    href: "/admin/feedback",
    label: "Feedback",
    icon: MessageCircleIcon,
  },
  {
    id: "trusted-members",
    href: "/admin/trusted-members",
    label: "Trusted members",
    icon: ShieldCheckIcon,
  },
  {
    id: "moderation",
    href: "/admin/moderation",
    label: "Moderation",
    icon: ClipboardCheckIcon,
  },
  {
    id: "waivers",
    href: "/admin/waivers",
    label: "Waivers",
    icon: SquarePenIcon,
  },
];

const navRowClass =
  "flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50";

function useIsActive({ activeTab }: AdminSidebarProps) {
  const pathname = usePathname();
  return (item: NavItem) =>
    activeTab !== undefined
      ? activeTab === item.id
      : item.exact
        ? pathname === item.href
        : pathname.startsWith(item.href);
}

/**
 * One navigation row. The row drives its icon, so the glyph plays once when
 * any part of the row is hovered or focused.
 */
function NavRow({
  item,
  isActive,
  onTabChange,
  onNavigate,
}: {
  item: NavItem;
  isActive: boolean;
  onTabChange?: (tab: string) => void;
  onNavigate?: () => void;
}) {
  const icon = useAnimatedIcon();
  const Icon = item.icon;
  const className = cn(
    navRowClass,
    isActive
      ? "bg-muted text-foreground font-medium"
      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
  );
  const content = (
    <>
      <Icon ref={icon.ref} size={16} aria-hidden="true" className="shrink-0" />
      <span className="truncate">{item.label}</span>
    </>
  );

  if (onTabChange) {
    return (
      <button
        type="button"
        className={className}
        aria-current={isActive ? "page" : undefined}
        onClick={() => {
          onTabChange(item.id);
          onNavigate?.();
        }}
        {...icon.triggerProps}
      >
        {content}
      </button>
    );
  }

  return (
    <Link
      href={item.href}
      className={className}
      aria-current={isActive ? "page" : undefined}
      onClick={onNavigate}
      {...icon.triggerProps}
    >
      {content}
    </Link>
  );
}

export function AdminSidebar(props: AdminSidebarProps = {}) {
  const isActive = useIsActive(props);

  return (
    // The aside stretches with the page so its border runs the full height;
    // only the inner column sticks to the viewport.
    <aside className="hidden w-60 shrink-0 border-r md:block">
      <div className="sticky top-0 flex h-screen flex-col p-3">
        <p className="px-2.5 pt-1 pb-3 text-sm font-semibold">Admin console</p>
        <nav
          aria-label="Admin"
          className="flex flex-1 flex-col gap-0.5 overflow-y-auto"
        >
          {navItems.map((item) => (
            <NavRow
              key={item.id}
              item={item}
              isActive={isActive(item)}
              onTabChange={props.onTabChange}
            />
          ))}
        </nav>
      </div>
    </aside>
  );
}

export function AdminMobileNav(props: AdminSidebarProps = {}) {
  const isActive = useIsActive(props);
  const menuIcon = useAnimatedIcon();
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        aria-label="Open admin navigation"
        className={cn(
          buttonVariants({ variant: "ghost", size: "icon" }),
          "md:hidden",
        )}
        {...menuIcon.triggerProps}
      >
        <MenuIcon ref={menuIcon.ref} size={16} aria-hidden="true" />
      </SheetTrigger>
      <SheetContent side="left" className="flex h-full w-72 flex-col gap-0 p-3">
        <SheetHeader className="px-2.5 pt-1 pb-3 text-left">
          <SheetTitle>Admin console</SheetTitle>
          <SheetDescription className="sr-only">
            Navigate admin tools
          </SheetDescription>
        </SheetHeader>
        <nav
          aria-label="Admin"
          className="flex flex-1 flex-col gap-0.5 overflow-y-auto"
        >
          {navItems.map((item) => (
            <NavRow
              key={item.id}
              item={item}
              isActive={isActive(item)}
              onTabChange={props.onTabChange}
              onNavigate={() => setOpen(false)}
            />
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
