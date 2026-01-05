import { Button } from "@react-email/components";
import * as React from "react";

interface EmailButtonProps {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "secondary";
}

export default function EmailButton({
  href,
  children,
  variant = "primary",
}: EmailButtonProps) {
  const baseStyles = {
    display: "inline-block",
    padding: "12px 32px",
    fontSize: "14px",
    fontWeight: "600" as const,
    textDecoration: "none",
    textAlign: "center" as const,
    cursor: "pointer",
    fontFamily:
      "'Inter', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif",
    lineHeight: "1.2",
    maxWidth: "100%",
  };

  const variantStyles = {
    primary: {
      backgroundColor: "#16a34a",
      border: "1px solid #15803d",
      color: "#ffffff",
    },
    secondary: {
      backgroundColor: "#ffffff",
      border: "1px solid #bbf7d0",
      color: "#166534",
    },
  };

  return (
    <Button
      href={href}
      style={{
        ...baseStyles,
        ...variantStyles[variant],
      }}
    >
      {children}
    </Button>
  );
}
