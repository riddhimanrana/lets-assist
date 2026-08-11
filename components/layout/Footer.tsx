"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { Mail } from "lucide-react";
import { siInstagram, siX } from "simple-icons";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { SimpleIcon } from "@/components/ui/simple-icon";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type FooterSystemStatus = "operational" | "degraded" | "outage" | "unknown";

// Every footer control has to clear the WCAG 2.2 24x24 target floor. The status
// badge (82.3x17) and the icon links (16x16) were all under it, and the footer
// renders on every page, so the target-size violation was global. The sizing
// lives in shared constants because both the mobile and desktop layouts render
// the same controls and had drifted apart.
const FOOTER_STATUS_LINK_CLASS =
  "inline-flex min-h-6 items-center gap-1.5 rounded-full border px-2 py-0.5 align-middle text-[11px] font-medium leading-none transition-colors outline-none hover:opacity-90 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]";

const FOOTER_ICON_LINK_CLASS =
  "text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:border-ring focus-visible:ring-ring/50 inline-flex size-8 items-center justify-center rounded-md border border-transparent transition-colors outline-none focus-visible:ring-[3px]";

const FOOTER_SOCIAL_LINKS: Array<{
  href: string;
  label: string;
  icon: ReactNode;
}> = [
  {
    href: "https://instagram.com/letsassist.app",
    label: "Instagram",
    icon: <SimpleIcon icon={siInstagram} className="size-4" />,
  },
  {
    href: "https://x.com/letsassistapp",
    label: "Twitter",
    icon: <SimpleIcon icon={siX} className="size-4" />,
  },
  {
    href: "mailto:contact@lets-assist.com",
    label: "Email",
    icon: <Mail className="size-4" />,
  },
];

function FooterSocialLinks({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-1", className)}>
      {FOOTER_SOCIAL_LINKS.map((link) => {
        const isExternal = link.href.startsWith("http");

        return (
          <Link
            key={link.href}
            href={link.href}
            target={isExternal ? "_blank" : undefined}
            rel={isExternal ? "noopener noreferrer" : undefined}
            className={FOOTER_ICON_LINK_CLASS}
            aria-label={link.label}
          >
            {link.icon}
          </Link>
        );
      })}
    </div>
  );
}

const FOOTER_STATUS_META: Record<
  FooterSystemStatus,
  {
    label: string;
    dotClassName: string;
    badgeClassName: string;
  }
> = {
  operational: {
    label: "Operational",
    dotClassName: "bg-success",
    badgeClassName: "border-success/35 bg-success/10 text-success",
  },
  degraded: {
    label: "Degraded",
    dotClassName: "bg-warning",
    badgeClassName: "border-warning/35 bg-warning/10 text-warning",
  },
  outage: {
    label: "Outage",
    dotClassName: "bg-destructive",
    badgeClassName: "border-destructive/35 bg-destructive/10 text-destructive",
  },
  unknown: {
    label: "Checking",
    dotClassName: "bg-warning",
    badgeClassName: "border-warning/35 bg-warning/10 text-warning",
  },
};

export function Footer() {
  const { user } = useAuth();
  const [systemStatus, setSystemStatus] =
    useState<FooterSystemStatus>("unknown");

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    const fetchStatus = async () => {
      try {
        const response = await fetch("/api/status", {
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) {
          if (isMounted) setSystemStatus("outage");
          return;
        }

        const payload = (await response.json()) as { status?: string };
        const next = payload.status;

        if (!isMounted) return;

        if (
          next === "operational" ||
          next === "degraded" ||
          next === "outage"
        ) {
          setSystemStatus(next);
          return;
        }

        setSystemStatus("unknown");
      } catch {
        if (isMounted) setSystemStatus("unknown");
      }
    };

    fetchStatus();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, []);

  const currentYear = new Date().getFullYear();
  const primaryLink = user
    ? { href: "/trusted-member", label: "Trusted Member" }
    : { href: "/", label: "Home" };

  const footerLinks = useMemo(
    () => [
      primaryLink,
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
      { href: "/help", label: "Help" },
      { href: "/contact", label: "Contact" },
      { href: "/acknowledgements", label: "Acknowledgements" },
    ],
    [primaryLink],
  );

  const statusMeta = FOOTER_STATUS_META[systemStatus];

  // The trigger RENDERS the link rather than wrapping it. A tooltip trigger is
  // a button by default, and a button containing an anchor is a nested
  // interactive control: assistive technology cannot address the inner link,
  // and this footer is on every page, so the violation was global.
  const statusBadge = (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            href="https://status.lets-assist.com"
            target="_blank"
            rel="noopener noreferrer"
            className={cn(FOOTER_STATUS_LINK_CLASS, statusMeta.badgeClassName)}
            aria-label={`System status: ${statusMeta.label}`}
          >
            <span
              className={cn("size-2 rounded-full", statusMeta.dotClassName)}
              aria-hidden="true"
            />
            <span className="leading-none">{statusMeta.label}</span>
          </Link>
        }
      />
      <TooltipContent side="top">
        Current system status based on our latest checks.
      </TooltipContent>
    </Tooltip>
  );

  return (
    <footer className="w-full border-t py-8 md:py-6">
      <div className="container px-4 mx-auto">
        {/* Mobile layout */}
        <div className="flex flex-col gap-6 md:hidden">
          <div className="flex justify-start ml-3">
            <Image
              src="/logo.png"
              alt="letsassist Logo"
              width={40}
              height={40}
              className="h-8 w-auto"
            />
          </div>

          <nav
            aria-label="Footer"
            className="grid grid-cols-2 gap-x-6 gap-y-3 text-left ml-3"
          >
            {footerLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Stacked rather than one justify-between row: at 320px the
              copyright, the 24px-tall status badge and three 32px targets do
              not fit on a single line without crowding them below the target
              floor again. */}
          <div className="ml-3 mr-3 border-t pt-4">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <p className="text-xs text-muted-foreground">
                  © {currentYear} Tulip Coaching LLC
                </p>
                {statusBadge}
              </div>

              <FooterSocialLinks className="-ml-2 flex-wrap" />
            </div>
          </div>
        </div>

        {/* Desktop layout */}
        <div className="hidden md:flex md:items-center md:justify-between md:gap-6">
          <div className="flex min-w-0 items-center gap-3">
            <Image
              src="/logo.png"
              alt="letsassist Logo"
              width={32}
              height={32}
            />
            <p className="text-sm text-muted-foreground whitespace-nowrap">
              © {currentYear} Tulip Coaching LLC
              <span className="hidden xl:inline">. All rights reserved.</span>
            </p>
            {statusBadge}
          </div>

          <div className="flex items-center gap-6">
            <nav
              aria-label="Legal and policies"
              className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-left"
            >
              {footerLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  {link.label}
                </Link>
              ))}
            </nav>

            <FooterSocialLinks className="-mr-2 shrink-0" />
          </div>
        </div>
      </div>
    </footer>
  );
}
