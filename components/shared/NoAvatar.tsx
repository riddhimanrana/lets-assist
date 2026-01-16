import React from "react";

type NoAvatarProps = {
  fullName?: string | null;
  className?: string;
};

export const NoAvatar: React.FC<NoAvatarProps> = ({ fullName, className }) => {
  if (!fullName) return "";

  const initials =
    fullName.split(" ").length > 1
      ? fullName
          .split(" ")
          .slice(0, 2)
          .map((name) => name[0])
          .join("")
      : fullName.substring(0, 2);

  return <span className={className}>{initials.toUpperCase()}</span>;
};
