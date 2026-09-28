import { useId, type InputHTMLAttributes } from "react";
import { cx } from "./cx";

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "id"> & {
  label: string;
};

// Native checkbox with its label, checked color from the accent token.
export function Checkbox({ label, className, ...props }: CheckboxProps) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={cx("inline-flex cursor-pointer select-none items-center gap-2 py-[9px] text-[13px] text-ink", className)}
    >
      <input id={id} type="checkbox" className="size-4 cursor-pointer accent-accent" {...props} />
      {label}
    </label>
  );
}
