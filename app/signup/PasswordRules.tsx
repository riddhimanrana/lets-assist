import { Check, Circle, CircleAlert } from "lucide-react";

import { cn } from "@/lib/utils";

/** The parts of `passwordSchema` a person can see themselves meeting. */
const PASSWORD_RULES = [
  {
    label: "At least 8 characters",
    isMet: (value: string) => value.length >= 8,
  },
  {
    label: "At least one letter",
    isMet: (value: string) => /[A-Za-z]/u.test(value),
  },
  {
    label: "At least one number",
    isMet: (value: string) => /\d/u.test(value),
  },
];

/**
 * The password rules as a quiet checklist. A rule turns to the success tone
 * once it is met. An unmet rule stays muted while the person is still typing
 * and only takes the warning tone once `showUnmet` is set, which the form does
 * after they leave the field or submit with something that fails.
 */
export function PasswordRules({
  id,
  value,
  showUnmet,
}: {
  id: string;
  value: string;
  showUnmet: boolean;
}) {
  return (
    <div id={id} className="grid gap-1.5 text-xs">
      <p className="text-muted-foreground font-medium">Password requirements</p>
      <ul className="grid gap-1">
        {PASSWORD_RULES.map((rule) => {
          const met = rule.isMet(value);
          const failed = !met && showUnmet && value.length > 0;
          const Icon = met ? Check : failed ? CircleAlert : Circle;

          return (
            <li
              key={rule.label}
              className={cn(
                "flex items-center gap-2",
                met
                  ? "text-success"
                  : failed
                    ? "text-warning"
                    : "text-muted-foreground",
              )}
            >
              <Icon className="size-3.5 shrink-0" aria-hidden="true" />
              <span>{rule.label}</span>
              <span className="sr-only">{met ? "(met)" : "(not met yet)"}</span>
            </li>
          );
        })}
      </ul>
      <p className="text-muted-foreground">
        Avoid passwords that are common or have appeared in a data breach.
      </p>
    </div>
  );
}
