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

import {
  featureLinks,
  isActiveDestination,
  memberLinks,
  publicLinks,
  type NavDestination,
} from "./destinations";

type Props = {
  isLoading: boolean;
  isAuthenticated: boolean;
  pathname: string;
};

const destinationClass = cn(
  buttonVariants({ variant: "ghost", size: "sm" }),
  "px-3 text-muted-foreground aria-[current=page]:bg-muted aria-[current=page]:text-foreground",
);

export function DesktopPrimaryNavigation({
  isLoading,
  isAuthenticated,
  pathname,
}: Props) {
  if (isLoading) return <div className="hidden lg:flex" />;

  return (
    <div className="hidden lg:flex items-center gap-1">
      {isAuthenticated ? (
        memberLinks.map((destination) => (
          <DestinationLink
            key={destination[1]}
            destination={destination}
            pathname={pathname}
            prefetch={false}
          />
        ))
      ) : (
        <>
          <NavigationMenu>
            <NavigationMenuList>
              <NavigationMenuItem>
                <NavigationMenuTrigger className={destinationClass}>
                  Features
                </NavigationMenuTrigger>
                <NavigationMenuContent>
                  <ul className="w-130">
                    {featureLinks.map((feature) => (
                      <FeatureItem key={feature.title} {...feature} />
                    ))}
                  </ul>
                </NavigationMenuContent>
              </NavigationMenuItem>
            </NavigationMenuList>
          </NavigationMenu>
          {publicLinks.map((destination) => (
            <DestinationLink
              key={destination[1]}
              destination={destination}
              pathname={pathname}
            />
          ))}
        </>
      )}
    </div>
  );
}

function DestinationLink({
  destination: [label, href],
  pathname,
  prefetch,
}: {
  destination: NavDestination;
  pathname: string;
  prefetch?: boolean;
}) {
  return (
    <Link
      href={href}
      prefetch={prefetch}
      aria-current={isActiveDestination(pathname, href) ? "page" : undefined}
      className={destinationClass}
    >
      {label}
    </Link>
  );
}

function FeatureItem({
  title,
  description,
  href,
}: (typeof featureLinks)[number]) {
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
