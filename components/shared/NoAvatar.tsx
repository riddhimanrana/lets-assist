import React from "react";

type NoAvatarProps = {
  fullName?: string | null;
  className?: string;
};

export const NoAvatar: React.FC<NoAvatarProps> = ({ fullName, className }) => {
  if (!fullName) return null;

  const parts = fullName.trim().split(/\s+/);
  const initials =
    parts.length > 1
      ? parts
          .slice(0, 2)
          .map((name) => name[0])
          .join("")
      : parts[0].substring(0, 2);

  const text = initials.toUpperCase();

  // If a className is provided, render a span so callers can style it.
  // Otherwise return just the text so it can be used inside AvatarFallback
  // without adding extra wrappers.
  if (className) {
    return <span className={className}>{text}</span>;
  }

  return <>{text}</>;
};
