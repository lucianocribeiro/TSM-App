import type { ButtonHTMLAttributes } from "react";
import { cx } from "./cx";

export type ButtonVariant = "primary" | "secondary";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

const base =
  "inline-flex items-center justify-center gap-2 rounded-md border bg-transparent px-4 py-2 text-[13px] leading-tight transition-colors disabled:cursor-not-allowed disabled:opacity-45";

const variants: Record<ButtonVariant, string> = {
  primary: "border-accent text-accent-deep enabled:hover:bg-accent-soft",
  secondary:
    "border-line text-ink enabled:hover:border-accent enabled:hover:text-accent-deep",
};

export function Button({
  variant = "primary",
  type = "button",
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(base, variants[variant], className)}
      {...props}
    />
  );
}
