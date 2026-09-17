import type { InputHTMLAttributes } from "react";
import { cx } from "./cx";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cx(
        "w-full rounded-md border border-line bg-transparent px-3 py-[9px] text-[14px] text-ink outline-none transition-colors focus:border-accent aria-invalid:border-accent",
        className,
      )}
      {...props}
    />
  );
}
