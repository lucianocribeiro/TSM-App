import { cx } from "./cx";

export type SegmentedOption<T extends string> = { value: T; label: string };

export type SegmentedFilterProps<T extends string> = {
  // Accessible name of the group.
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
};

// Bordered group of mutually exclusive filter buttons (design system spec).
export function SegmentedFilter<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: SegmentedFilterProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cx("inline-flex overflow-hidden rounded-md border border-line", className)}
    >
      {options.map((option, index) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cx(
              "px-[14px] py-[9px] text-[12.5px] transition-colors hover:bg-accent-soft",
              index > 0 && "border-l border-line-soft",
              active ? "text-accent-deep" : "text-ink",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
