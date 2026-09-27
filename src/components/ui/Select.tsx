import { useId, type SelectHTMLAttributes } from "react";
import { cx } from "./cx";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  options: readonly { value: string; label: string }[];
};

// Label + native select, styled like Field.
export function Select({ label, options, className, ...props }: SelectProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[10.5px] uppercase tracking-[.16em] text-ink-soft">
        {label}
      </label>
      <select
        id={id}
        className={cx(
          "w-full rounded-md border border-line bg-surface px-3 py-[9px] text-[14px] text-ink outline-none transition-colors focus:border-accent",
          className,
        )}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
