// components/Navbar.tsx
"use client";

import * as React from "react";
import Link from "next/link";
import {
  Menu,
  UserRound,
  LogOut,
  Settings,
  Heart,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Bell,
  Sun,
  Moon,
  Laptop,
  MonitorSmartphone,
  Loader2,
} from "lucide-react";
import { NoAvatar } from "@/components/NoAvatar";
import { logout } from "@/app/logout/actions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
} from "@/components/ui/sheet";
import { ModeToggle } from "@/components/theme-toggle";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { DonateDialog } from "@/components/DonateDialog";
import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import { NotificationPopover } from "@/components/NotificationPopover";
import { useTheme } from "next-themes";
import { usePathname } from "next/navigation";
import { FeedbackDialog } from "@/components/FeedbackDialog";
import { useAuth } from "@/hooks/useAuth";
import { createClient } from "@/utils/supabase/client";

interface SectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

const CollapsibleSection = ({
  title,
  children,
  defaultOpen = false,
}: SectionProps) => {
  const [isOpen, setIsOpen] = React.useState(defaultOpen);

  return (
    <div className="mb-4">
      <button
        className="flex w-full items-center justify-between py-2"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="text-base font-bold">{title}</span>
        {isOpen ? (
          <ChevronUp className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
      </button>
      {isOpen && <div className="mt-1 space-y-1">{children}</div>}
    </div>
  );
};

const features = [
  {
    title: "Volunteer Journey",
    href: "/#journey",
    description: "Browse opportunities, confirm attendance, and earn certificates.",
  },
  {
    title: "Platform Features",
    href: "/#features",
    description: "Calendar sync, dashboards, QR check-ins, and trusted event types.",
  },
  {
    title: "Organization Tooling",
    href: "/#org-tooling",
    description: "Role-based member management, certified reports, and QR verification.",
  },
];

export default function Navbar() {
  // Use centralized auth hook instead of manual state management
  const { user, isLoading: isProfileLoading } = useAuth();
  
  const [profile, setProfile] = React.useState<{
    full_name: string;
    avatar_url: string;
    username: string;
  } | null>(null);
  const [showBugDialog, setShowBugDialog] = useState(false);
  const [showDonateDialog, setShowDonateDialog] = useState(false);
  const [showFeedbackDialog, setShowFeedbackDialog] = useState(false);
  const [isSheetOpen, setIsSheetOpen] = React.useState(false);
  const { theme, setTheme } = useTheme();
  // Add loading state for logout
  const [isLoggingOut, setIsLoggingOut] = React.useState(false);
  const pathname = usePathname();

  const supabase = React.useMemo(() => createClient(), []);

  const fetchProfile = React.useCallback(
    async (userId: string) => {
      try {
        const { data: profileData, error } = await supabase
          .from("profiles")
          .select("full_name, avatar_url, username")
          .eq("id", userId)
          .single();

        if (error) {
          console.debug("Profile fetch error", error);
        }

        setProfile(profileData ?? null);
      } catch (error) {
        console.debug("Profile fetch exception", error);
        setProfile(null);
      }
    },
    [supabase],
  );

  // Update profile when user changes
  React.useEffect(() => {
    if (user?.id) {
      fetchProfile(user.id);
    } else {
      setProfile(null);
    }
  }, [user?.id, fetchProfile]);

  const handleNavigation = () => {
    setIsSheetOpen(false);
  };

  // Vercel-style theme selector component for dropdown menu
  const ThemeSelector = () => (
    <div className="relative flex items-center border rounded-lg p-0.5 space-x-1">
      <Button
      variant="ghost"
      size="icon"
      className={cn(
        "relative z-10 h-6 w-6 flex items-center justify-center rounded-md",
        theme === "light" && "text-primary bg-accent"
      )}
      onClick={() => setTheme("light")}
      >
      <Sun className="h-3 w-3" />
      </Button>
      <Button 
      variant="ghost"
      size="icon"
      className={cn(
        "relative z-10 h-6 w-6 flex items-center justify-center rounded-md",
        theme === "dark" && "text-primary bg-accent"
      )}
      onClick={() => setTheme("dark")}
      >
      <Moon className="h-3 w-3" />
      </Button>
      <Button
      variant="ghost" 
      size="icon"
      className={cn(
        "relative z-10 h-6 w-6 flex items-center justify-center rounded-md",
        theme === "system" && "text-primary bg-accent"
      )}
      onClick={() => setTheme("system")}
      >
      <MonitorSmartphone className="h-3 w-3" />
      </Button>
    </div>
  );

  // Mobile version of the theme selector with similar styling
  const MobileThemeSelector = () => (
    <div className="space-y-2">
      <div className="relative flex items-center border rounded-lg space-x-1 p-1">
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "relative z-10 h-8 w-8 flex items-center justify-center rounded-md",
            theme === "light" && "text-primary bg-accent"
          )}
          onClick={() => setTheme("light")}
        >
          <Sun className="h-4 w-4" />
        </Button>
        <Button 
          variant="ghost"
          size="icon"
          className={cn(
            "relative z-10 h-8 w-8 flex items-center justify-center rounded-md",
            theme === "dark" && "text-primary bg-accent"
          )}
          onClick={() => setTheme("dark")}
        >
          <Moon className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost" 
          size="icon"
          className={cn(
            "relative z-10 h-8 w-8 flex items-center justify-center rounded-md",
            theme === "system" && "text-primary bg-accent"
          )}
          onClick={() => setTheme("system")}
        >
          <MonitorSmartphone className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );

  // Handle logout with loading state
  const handleLogout = async () => {
    try {
      setIsLoggingOut(true);
      
      // Log out via server action
      const result = await logout();
      
      if (result.success) {
        // useAuth hook will automatically handle cache clearing via auth listener
        // Use a small delay before redirecting to ensure state updates are processed
        setTimeout(() => {
          window.location.href = "/";
        }, 100);
      } else {
        console.error('Logout failed:', result.error);
        setIsLoggingOut(false);
      }
    } catch (error) {
      console.error('Logout failed:', error);
      setIsLoggingOut(false);
    }
  };

  return (
    <>
      <div>
        <nav className="flex items-center justify-between p-3 bg-background">
          <Link href="/">
            <div className="flex items-center space-x-2">
              <Image
                src="/logo.png"
                alt="letsassist logo"
                width={30}
                height={30}
              />
              <span className="text-lg font-bold">letsassist</span>
            </div>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-6 ml-auto">
            {user ? (
              <>
                <Button variant="ghost" asChild>
                  <Link
                    className={cn(
                      pathname === "/home" ? "text-primary font-semibold" : "text-muted-foreground"
                    )}
                    href="/home"
                  >
                    Home
                  </Link>
                </Button>
                <Button variant="ghost" asChild>
                  <Link
                    className={cn(
                      pathname === "/dashboard" ? "text-primary font-semibold" : "text-muted-foreground"
                    )}
                    href="/dashboard"
                  >
                    Volunteer Dashboard
                  </Link>
                </Button>
                <Button variant="ghost" asChild>
                  <Link
                    className={cn(
                      pathname === "/projects" ? "text-primary font-semibold" : "text-muted-foreground"
                    )}
                    href="/projects"
                  >
                    My Projects
                  </Link>
                </Button>
                <Button variant="ghost" asChild>
                  <Link
                    className={cn(
                      pathname === "/organization" ? "text-primary font-semibold" : "text-muted-foreground"
                    )}
                    href="/organization"
                  >
                    Organizations
                  </Link>
                </Button>
                <Button variant="ghost" asChild>
                  <Link
                    className={cn(
                      pathname === "/faq" ? "text-primary font-semibold" : "text-muted-foreground"
                    )}
                    href="/faq"
                  >
                    FAQ
                  </Link>
                </Button>
                
              </>
            ) : (
              <>
                <NavigationMenu>
                  <NavigationMenuList>
                    <NavigationMenuItem>
                      <NavigationMenuTrigger className={cn(pathname === "/#features" && "bg-accent text-accent-foreground")}>Features</NavigationMenuTrigger>
                      <NavigationMenuContent>
                        <ul className="grid gap-3 p-6 md:w-[400px] lg:w-[500px] lg:grid-cols-[.75fr_1fr]">
                          <li className="row-span-3">
                            <NavigationMenuLink asChild>
                              <Link
                                className="flex h-full w-full select-none flex-col justify-end rounded-md bg-gradient-to-b from-muted/50 to-muted p-6 no-underline outline-none focus:shadow-md"
                                href="/"
                              >
                                <Image
                                  src="/logo.png"
                                  alt="letsassist logo"
                                  width={30}
                                  height={30}
                                />
                                <div className="mb-2 mt-4 text-lg font-medium">
                                  letsassist
                                </div>
                                <p className="text-sm leading-tight text-muted-foreground">
                                  Helping communities and volunteers connect
                                </p>
                              </Link>
                            </NavigationMenuLink>
                          </li>
                          {features.map((feature) => (
                            <ListItem
                              key={feature.title}
                              title={feature.title}
                              href={feature.href}
                            >
                              {feature.description}
                            </ListItem>
                          ))}
                        </ul>
                      </NavigationMenuContent>
                    </NavigationMenuItem>
                  </NavigationMenuList>
                </NavigationMenu>
                <Button variant="ghost" asChild>
                  <Link href="/projects" className={cn(
                      pathname === "/projects" ? "text-primary font-semibold" : "text-muted-foreground"
                    )}>Volunteering Near Me</Link>
                </Button>
                <Button variant="ghost" asChild>
                  <Link href="/organization" className={cn(
                      pathname === "/organization" ? "text-primary font-semibold" : "text-muted-foreground"
                    )}>Connected Organizations</Link>
                </Button>
                <Button variant="ghost" asChild>
                  <Link href="/faq" className={cn(
                      pathname === "/faq" ? "text-primary font-semibold" : "text-muted-foreground"
                    )}>
                    FAQ
                  </Link>
                </Button>
              </>
            )}
          </div>
          <div className="hidden sm:flex items-center space-x-6 ml-auto">
            {user ? (
              <div className="flex items-center space-x-5 mr-2">
                <NotificationPopover />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    {isProfileLoading ? (
                      <Skeleton className="w-9 h-9 rounded-full" />
                    ) : (
                      <div className="relative group w-9 h-9">
                        {/* The glowing circle behind the avatar, only visible on hover */}
                        <span
                          aria-hidden="true"
                          className="absolute inset-0 rounded-full bg-muted-foreground/10 scale-105 opacity-0 group-hover:opacity-100 group-hover:scale-125 transition-all duration-200 pointer-events-none"
                        />
                        <Avatar className="w-9 h-9 cursor-pointer relative z-10">
                          <AvatarImage src={profile?.avatar_url} />
                          <AvatarFallback>
                            <NoAvatar fullName={profile?.full_name} />
                          </AvatarFallback>
                        </Avatar>
                      </div>
                    )}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    className="w-64 pt-3 px-2 pb-2"
                    align="end"
                    forceMount
                  >
                    <DropdownMenuLabel className="font-normal mb-2">
                      <div className="flex flex-col space-y-2">
                        <p className="text-sm font-medium leading-tight">
                          {profile?.full_name}
                        </p>
                        <p className="text-sm leading-none text-muted-foreground">
                          {user.email}
                        </p>
                      </div>
                    </DropdownMenuLabel>
                    {/* <DropdownMenuSeparator className="my-2" /> */}
                    <DropdownMenuItem
                      className="py-2.5 text-muted-foreground cursor-pointer"
                      asChild
                    >
                      <Link href="/home">
                        <span>Volunteer Dashboard</span>
                      </Link>
                    </DropdownMenuItem>

                    
                    <DropdownMenuItem
                      className="py-2.5 text-muted-foreground cursor-pointer"
                      asChild
                    >
                      <Link href={`/profile/${profile?.username}`}>
                        <span>My Profile</span>
                      </Link>
                    </DropdownMenuItem>
<DropdownMenuItem
                      className="py-2.5 text-muted-foreground cursor-pointer"
                      asChild
                    >
                      <Link href="/account/profile">
                        <span>Account Settings</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="my-2" />

                    {/* Replace custom theme selector with new Vercel-style ThemeSelector */}
                    <div className="px-2 py-0.5 flex justify-between">
                      <span className="text-sm self-center text-muted-foreground block">
                        Appearance
                      </span>
                      <ThemeSelector />
                    </div>

                    <DropdownMenuSeparator className="my-2" />

                    <DropdownMenuItem
                      className="text-chart-3 focus:text-chart-3 py-2.5 cursor-pointer flex justify-between"
                      onSelect={(e) => {
                        e.preventDefault();
                        setShowFeedbackDialog(true);
                      }}
                    >
                      Send Feedback
                      <MessageSquare className="h-4 w-4" />
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                      className="text-chart-4 focus:text-chart-4 py-2.5 cursor-pointer flex justify-between"
                      onSelect={(e) => {
                        e.preventDefault();
                        setShowDonateDialog(true);
                      }}
                    >
                      <span>Donate</span>
                      <Heart className="h-4 w-4" />
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="my-2" />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive py-2.5 cursor-pointer flex justify-between"
                      onClick={handleLogout}
                      disabled={isLoggingOut}
                    >
                      <span>{isLoggingOut ? "Logging out..." : "Log Out"}</span>
                      {isLoggingOut ? (
                        <Loader2 className="h-4 w-4" />
                      ) : (
                        <LogOut className="h-4 w-4" />
                      )}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ) : (
              <>
                <Link href="/login">
                  <Button variant="ghost">Login</Button>
                </Link>
                <Link href="/signup">
                  <Button>Sign Up</Button>
                </Link>
                <div className="ml-4">
                  <ModeToggle />
                </div>
              </>
            )}
          </div>

          {/* Mobile Navigation */}
          <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
            <SheetTitle className="hidden"></SheetTitle>
            <div className="sm:hidden flex items-center ml-auto">
              {user && <NotificationPopover />}
              {/* Show theme toggle for non-logged in users only */}
              {!user && <ModeToggle />}
            </div>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden ml-2">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Toggle menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[85%] sm:w-[380px] pt-10 px-4 pb-4 overflow-y-auto">
              <div className="flex flex-col h-full">
                {user ? (
                  <>
                    <div className="flex items-center space-x-3 mb-4">
                      {isProfileLoading ? (
                        <Skeleton className="w-12 h-12 rounded-full" />
                      ) : (
                        <Avatar className="w-12 h-12">
                          <AvatarImage src={profile?.avatar_url} />
                          <AvatarFallback>
                            <NoAvatar fullName={profile?.full_name} />
                          </AvatarFallback>
                        </Avatar>
                      )}
                      <div className="flex flex-col">
                        <p className="font-medium">{profile?.full_name}</p>
                        <p className="text-sm text-muted-foreground">
                          {user.email}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="destructive"
                      className="w-full mb-6"
                      onClick={handleLogout}
                      disabled={isLoggingOut}
                    >
                      {isLoggingOut ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <LogOut className="mr-2 h-4 w-4" />
                      )}
                      {isLoggingOut ? "Logging out..." : "Log Out"}
                    </Button>

                    {/* Replace theme selector for logged-in users on mobile */}
                  </>
                ) : (
                  <div className="grid gap-2 mb-6">
                    <Link href="/login" className="w-full" onClick={handleNavigation}>
                      <Button variant="outline" className="w-full">
                        Login
                      </Button>
                    </Link>
                    <Link href="/signup" className="w-full" onClick={handleNavigation}>
                      <Button className="w-full">Sign Up</Button>
                    </Link>
                  </div>
                )}

                <Separator className="mb-4" />

                <div className="space-y-1">
                  {user ? (
                    <>
                      <Button
                        variant="ghost"
                        className="w-full justify-between text-muted-foreground"
                        asChild
                        onClick={handleNavigation}
                      >
                        <Link href="/home">Home</Link>
                      </Button>
                      <Button
                        variant="ghost"
                        className="w-full justify-between text-muted-foreground"
                        asChild
                        onClick={handleNavigation}
                      >
                        <Link href="/dashboard">Volunteer Dashboard</Link>
                      </Button>
                      <Button
                        variant="ghost"
                        className="w-full justify-between text-muted-foreground"
                        asChild
                        onClick={handleNavigation}
                      >
                        <Link href="/projects">My Projects</Link>
                      </Button>
                      
                      <Button
                        variant="ghost"
                        className="w-full justify-between text-muted-foreground"
                        asChild
                        onClick={handleNavigation}
                      >
                        <Link href= "/organization">Organizations</Link>
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        variant="ghost"
                        className="w-full justify-between text-muted-foreground"
                        onClick={handleNavigation}
                        asChild
                      >
                        <Link href="/projects">Volunteering Near Me</Link>
                      </Button>
                      <Button
                        variant="ghost"
                        className="w-full justify-between text-muted-foreground"
                        onClick={handleNavigation}
                        asChild
                      >
                        <Link href="/organization">Connected Organizations</Link>
                      </Button>
                    </>
                  )}
                  <Button
                    variant="ghost"
                    className="w-full justify-between text-muted-foreground"
                    onClick={handleNavigation}
                    asChild
                  >
                    <Link href="/faq">FAQ</Link>
                  </Button>
                </div>

                {user && (
                  <>
                    <Separator className="my-4" />
                    <Button
                      variant="ghost"
                      className="w-full justify-between text-muted-foreground"
                      asChild
                      onClick={handleNavigation}
                    >
                      <Link href="/account/profile">
                        Account Settings
                        <Settings className="h-4 w-4" />
                      </Link>
                    </Button>
                    {/* Re-enable MobileNotificationButton now that we're storing notifications */}
                    {/* <MobileNotificationButton /> */}
                    <Button
                      variant="ghost"
                      className="w-full justify-between text-muted-foreground"
                      asChild
                      onClick={handleNavigation}
                    >
                      <Link href={`/profile/${profile?.username}`}>
                        My Profile
                        <UserRound className="h-4 w-4" />
                      </Link>
                    </Button>
                  </>
                )}

                <Separator className="my-4" />
                <div className="px-4 py-0.5 flex justify-between">
                <span className="text-sm self-center text-muted-foreground block">
                Appearance
                </span>
                <MobileThemeSelector />
                </div>
                <Separator className="my-4" />
                <div className="space-y-1">
                  <Button
                    variant="ghost"
                    className="w-full justify-between text-chart-3 hover:text-chart-3 hover:bg-chart-3/10"
                    onClick={() => {
                      setShowFeedbackDialog(true);
                      handleNavigation();
                    }}
                  >
                    Send Feedback
                    <MessageSquare className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    className="w-full justify-between text-chart-4 hover:text-chart-4 hover:bg-chart-4/10"
                    onClick={() => {
                      setShowDonateDialog(true);
                      handleNavigation();
                    }}
                  >
                    Donate
                    <Heart className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </nav>
      </div>
      <Separator />
      <DonateDialog open={showDonateDialog} onOpenChange={setShowDonateDialog} />
      {showFeedbackDialog && (
        <FeedbackDialog onOpenChangeAction={setShowFeedbackDialog} />
      )}
    </>
  );
}

const ListItem = React.forwardRef<
  React.ComponentRef<"a">,
  React.ComponentPropsWithoutRef<"a">
>(({ className, title, children, ...props }, ref) => {
  return (
    <li>
      <NavigationMenuLink asChild>
        <a
          ref={ref}
          className={cn(
            "block select-none space-y-1 rounded-md p-3 leading-none no-underline outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
            className,
          )}
          {...props}
        >
          <div className="text-sm font-medium leading-none">{title}</div>
          <p className="line-clamp-2 text-sm leading-snug text-muted-foreground">
            {children}
          </p>
        </a>
      </NavigationMenuLink>
    </li>
  );
});
ListItem.displayName = "ListItem";