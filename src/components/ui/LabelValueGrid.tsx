import type { ReactNode } from "react";
import { cx } from "./cx";

export type LabelValueItem = {
  key: string;
  label: string;
  value: ReactNode;
  // Extra line under the value (for example, a pending change).
  note?: ReactNode;
};

// Label/value grid from the design system: auto-fit columns of at least 150px,
// labels in the input label style, values at 15px.
export function LabelValueGrid({ items, className }: { items: LabelValueItem[]; className?: string }) {
  return (
    <dl
      className={cx(
        "grid gap-x-[26px] gap-y-[18px] [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]",
        className,
      )}
    >
      {items.map((item) => (
        <div key={item.key} className="flex min-w-0 flex-col gap-1.5" data-campo={item.key}>
          <dt className="text-[10.5px] uppercase tracking-[.16em] text-accent-deep">{item.label}</dt>
          <dd className="break-words text-[15px]">{item.value}</dd>
          {item.note ? <dd className="text-[12.5px] italic text-accent-deep">{item.note}</dd> : null}
        </div>
      ))}
    </dl>
  );
}
