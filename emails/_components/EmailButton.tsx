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
    borderRadius: "12px",
    transition: "background-color 0.2s ease",
  };

  const variantStyles = {
    primary: {
      backgroundColor: "#16a34a",
      color: "#ffffff",
    },
    secondary: {
      backgroundColor: "#ffffff",
      color: "#166534",
    },
  };

  const hoverStyles = {
    primary: "#15813d",
    secondary: "#f7fee7",
  };

  return (
    <>
      <style>{`
        .button-${variant}:hover {
          background-color: ${hoverStyles[variant]} !important;
        }
      `}</style>
      <Button
        href={href}
        className={`button-${variant}`}
        style={{
          ...baseStyles,
          ...variantStyles[variant],
        }}
      >
        {children}
      </Button>
    </>
  );
}
