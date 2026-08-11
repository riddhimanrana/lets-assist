import Link from "next/link";

import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const features = [
  {
    title: "Volunteer Journey",
    href: "/#journey",
    description:
      "Browse opportunities, confirm attendance, and earn certificates.",
  },
  {
    title: "Platform Features",
    href: "/#features",
    description:
      "Calendar sync, dashboards, QR check-ins, and trusted event types.",
  },
  {
    title: "Organization Tooling",
    href: "/#org-tooling",
    description:
      "Role-based member management, certified reports, and QR verification.",
  },
] as const;

const primaryLinks = [
  ["Home", "/home"],
  ["Volunteer Dashboard", "/dashboard"],
  ["My Projects", "/projects"],
  ["Organizations", "/organization"],
] as const;

const publicLinks = [
  ["Volunteering Near Me", "/projects"],
  ["Connected Organizations", "/organization"],
  ["FAQ", "/faq"],
] as const;

type Props = {
  isLoading: boolean;
  isAuthenticated: boolean;
  pathname: string;
};

export function DesktopPrimaryNavigation({
  isLoading,
  isAuthenticated,
  pathname,
}: Props) {
  if (isLoading) return <div className="hidden lg:flex ml-auto" />;

  return (
    <div className="hidden lg:flex items-center space-x-4 ml-auto">
      {isAuthenticated ? (
        <>
          {primaryLinks.map(([label, href]) => (
            <Link
              key={href}
              className={cn(
                buttonVariants({ variant: "ghost" }),
                pathname === href
                  ? "text-primary font-semibold"
                  : "text-muted-foreground",
              )}
              href={href}
              prefetch={false}
            >
              {label}
            </Link>
          ))}
        </>
      ) : (
        <>
          <NavigationMenu>
            <NavigationMenuList>
              <NavigationMenuItem>
                <NavigationMenuTrigger
                  className={cn(
                    buttonVariants({ variant: "ghost" }),
                    "text-muted-foreground",
                  )}
                >
                  Features
                </NavigationMenuTrigger>
                <NavigationMenuContent>
                  <ul className="w-130">
                    {features.map((feature) => (
                      <FeatureItem key={feature.title} {...feature} />
                    ))}
                  </ul>
                </NavigationMenuContent>
              </NavigationMenuItem>
            </NavigationMenuList>
          </NavigationMenu>
          {publicLinks.map(([label, href]) => (
            <Link
              key={href}
              href={href}
              className={cn(
                buttonVariants({ variant: "ghost" }),
                pathname === href
                  ? "text-primary font-semibold"
                  : "text-muted-foreground",
              )}
            >
              {label}
            </Link>
          ))}
        </>
      )}
    </div>
  );
}

function FeatureItem({ title, description, href }: (typeof features)[number]) {
  return (
    <li>
      <NavigationMenuLink
        render={
          <Link href={href}>
            <div className="flex flex-col gap-1 text-sm">
              <div className="leading-none font-medium">{title}</div>
              <div className="text-muted-foreground line-clamp-2">
                {description}
              </div>
            </div>
          </Link>
        }
      />
    </li>
  );
}
