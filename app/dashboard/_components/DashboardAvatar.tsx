import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { NoAvatar } from "@/components/shared/NoAvatar";

/** Existing public imagery stays visible; missing or failed images keep initials. */
export function DashboardAvatar({
  name,
  src,
  square = false,
}: {
  name: string;
  src?: string | null;
  square?: boolean;
}) {
  return (
    <Avatar
      size="lg"
      className={`size-12 border border-border data-[size=lg]:size-12 ${square ? "rounded-lg after:rounded-lg" : ""}`}
    >
      <AvatarImage
        src={src ?? undefined}
        alt=""
        className={square ? "rounded-lg" : undefined}
      />
      <AvatarFallback className={square ? "rounded-lg" : undefined}>
        <NoAvatar fullName={name} />
      </AvatarFallback>
    </Avatar>
  );
}
