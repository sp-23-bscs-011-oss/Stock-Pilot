import type { ComponentProps } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

// shadcn/ui Badge, adapted to StockPilot's existing color tokens and prefixed utilities.
const badgeVariants = cva(
  "tw:inline-flex tw:items-center tw:rounded-full tw:px-2.5 tw:py-1 tw:text-xs tw:font-semibold tw:whitespace-nowrap tw:transition-colors",
  { variants: { variant: {
    default: "tw:bg-[var(--accent-soft)] tw:text-[var(--accent)]",
    secondary: "tw:bg-[var(--surface-muted)] tw:text-[var(--text)]",
    success: "tw:bg-[var(--ok-soft)] tw:text-[var(--ok)]",
    warning: "tw:bg-[var(--warn-soft)] tw:text-[var(--warn)]",
  } }, defaultVariants: { variant: "default" } },
);

export function Badge({ className, variant, asChild = false, ...props }:
  ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";
  return <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}
