import { Building2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type InviteOrganization = {
  name: string;
  username?: string | null;
  logo_url: string | null;
};

/** Centres an invite card or a result state in the viewport. */
export function InviteShell({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex min-h-[70svh] w-full items-center justify-center px-4 py-10 sm:px-6",
        className,
      )}
      {...props}
    />
  );
}

/**
 * One card for every way of joining an organization: join code (signed out or
 * joining) and email invitation. Organization identity on top, one sentence of
 * context, optional notices, then the actions.
 */
export function InviteCard({
  organization,
  badge,
  description,
  children,
  footer,
}: {
  organization?: InviteOrganization | null;
  badge?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const name = organization?.name || "this organization";

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="justify-items-center gap-2 text-center">
        <Avatar className="mb-1 size-14">
          <AvatarImage src={organization?.logo_url || undefined} alt="" />
          <AvatarFallback>
            <Building2 className="text-muted-foreground size-6" />
          </AvatarFallback>
        </Avatar>
        <CardTitle className="text-lg text-balance">
          Join <span>{name}</span>
        </CardTitle>
        {organization?.username ? (
          <CardDescription>@{organization.username}</CardDescription>
        ) : null}
        {badge}
      </CardHeader>
      {description || children ? (
        <CardContent className="grid gap-4">
          {description ? (
            <p className="text-muted-foreground text-center text-sm text-pretty">
              {description}
            </p>
          ) : null}
          {children}
        </CardContent>
      ) : null}
      {footer ? (
        <CardFooter className="flex-col items-stretch gap-2">
          {footer}
        </CardFooter>
      ) : null}
    </Card>
  );
}
