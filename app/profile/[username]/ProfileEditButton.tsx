"use client";

import Link from "next/link";

import { SquarePenIcon, useAnimatedIcon } from "@/components/icons/animated";
import { Button } from "@/components/ui/button";

/** The owner's header action on their own profile. */
export function ProfileEditButton() {
  const icon = useAnimatedIcon();

  return (
    <Button
      variant="outline"
      render={<Link href="/account/profile" />}
      {...icon.triggerProps}
    >
      <SquarePenIcon
        ref={icon.ref}
        size={16}
        data-icon="inline-start"
        aria-hidden="true"
      />
      Edit profile
    </Button>
  );
}
