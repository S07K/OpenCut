"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-text hover:bg-accent-hover",
  secondary:
    "bg-surface-raised text-text-primary border border-border-default hover:bg-surface-overlay",
  ghost: "text-text-secondary hover:bg-surface-raised hover:text-text-primary",
  danger: "bg-danger text-white hover:opacity-90",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-6 px-2 text-xs gap-1 rounded-xs",
  md: "h-8 px-3 text-sm gap-1.5 rounded-sm",
};

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap",
        "duration-fast transition-colors",
        "focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none",
        "disabled:pointer-events-none disabled:opacity-40",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: icon-only controls are invisible to screen readers without it. */
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  active?: boolean;
}

export function IconButton({
  label,
  variant = "ghost",
  size = "md",
  active,
  className,
  children,
  ...props
}: IconButtonProps) {
  return (
    <button
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        "duration-fast transition-colors",
        "focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none",
        "disabled:pointer-events-none disabled:opacity-40",
        VARIANT_CLASSES[variant],
        size === "sm" ? "h-6 w-6 rounded-xs" : "h-8 w-8 rounded-sm",
        active && "bg-accent-muted text-accent",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
