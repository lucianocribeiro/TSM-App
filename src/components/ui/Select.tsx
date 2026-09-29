import { useId, type SelectHTMLAttributes } from "react";
import { cx } from "./cx";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  options: readonly { value: string; label: string }[];
  // Shown as a first, empty option (for example "Elegí una opción").
  placeholder?: string;
  error?: string;
};

// Label + native select, styled like Field, with the same error display.
export function Select({ label, options, placeholder, error, className, ...props }: SelectProps) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[10.5px] uppercase tracking-[.16em] text-accent-deep">
        {label}
      </label>
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cx(
          "w-full rounded-md border border-line bg-surface px-3 py-[9px] text-[14px] text-ink outline-none transition-colors focus:border-accent aria-invalid:border-accent",
          className,
        )}
        {...props}
      >
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? (
        <p id={errorId} className="text-[12.5px] italic text-accent-deep">
          {error}
        </p>
      ) : null}
    </div>
  );
}
