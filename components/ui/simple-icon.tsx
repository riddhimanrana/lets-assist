import type { SimpleIcon } from "simple-icons";
import { cn } from "@/lib/utils";

type SimpleIconProps = {
  icon: SimpleIcon;
  className?: string;
  title?: string;
};

export function SimpleIcon({ icon, className, title }: SimpleIconProps) {
  return (
    <svg
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      viewBox="0 0 24 24"
      className={cn("h-4 w-4", className)}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      {title ? <title>{title}</title> : null}
      <path d={icon.path} />
    </svg>
  );
}