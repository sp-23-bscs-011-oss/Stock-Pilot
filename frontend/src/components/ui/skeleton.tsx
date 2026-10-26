import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="skeleton" className={cn("tw:animate-pulse tw:rounded-md tw:bg-[var(--surface-muted)] tw:motion-reduce:animate-none", className)} {...props} />;
}
