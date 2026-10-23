import type { ReactNode } from "react";

interface AlertProps {
  tone?: "error" | "info" | "success" | "warn";
  children: ReactNode;
}

export function Alert({ tone = "info", children }: AlertProps) {
  // Errors interrupt; everything else is announced politely.
  return (
    <div className={`alert alert--${tone}`} role={tone === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}
