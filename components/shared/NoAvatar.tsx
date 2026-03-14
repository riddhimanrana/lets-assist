"use client";

import React from "react";

type NoAvatarProps = {
  fullName?: string | null;
  className?: string;
};

/**
 * Returns only the user's monogram text.
 * The surrounding avatar/fallback UI should be handled by the shared Avatar components.
 */
export const NoAvatar: React.FC<NoAvatarProps> = ({ fullName, className }) => {
  const trimmedFullName = fullName?.trim();

  if (!trimmedFullName) return null;

  const parts = trimmedFullName.split(/\s+/);
  const initials =
    parts.length > 1
      ? parts
          .slice(0, 2)
          .map((name) => name[0])
          .join("")
      : parts.length === 1
        ? parts[0].substring(0, 2)
        : null;

  if (!initials) return null;

  const text = initials.toUpperCase();

  if (className) {
    return <span className={className}>{text}</span>;
  }

  return <>{text}</>;
};
