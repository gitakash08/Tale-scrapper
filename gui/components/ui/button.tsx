import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "tap-press inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary-hover shadow-lg shadow-primary/20",
        outline: "border border-primary/40 text-primary hover:bg-primary/10",
        secondary: "bg-secondary text-secondary-foreground hover:bg-accent",
        ghost: "text-muted-foreground hover:text-primary hover:bg-white/5",
        destructive: "bg-destructive text-destructive-foreground hover:opacity-90",
        success: "bg-emerald-500 text-emerald-950 hover:bg-emerald-400 shadow-lg shadow-emerald-500/20",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-5 [&_svg]:size-4",
        sm: "h-8 px-3.5 text-xs [&_svg]:size-3.5",
        lg: "h-12 px-7 text-base [&_svg]:size-5",
        icon: "size-10 [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

function Button({
  className, variant, size, asChild = false, ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { Button, buttonVariants };
