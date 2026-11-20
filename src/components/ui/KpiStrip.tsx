import Link from "next/link";
import { cx } from "./cx";

// link: an optional way on from the number (its own line under the value).
export type KpiItem = { key: string; label: string; value: number; link?: { href: string; label: string } };

// KPI strip from the design system: one bordered surface container, auto-fit
// cells of at least 148px separated by --line-soft; label in the input label
// style, value in the heading font at 36px with lining, tabular numbers
// (Cormorant's default old-style figures make a 1 look like an I).
export function KpiStrip({ label, items, className }: { label: string; items: KpiItem[]; className?: string }) {
  return (
    <dl
      aria-label={label}
      className={cx(
        // The 1px gap over a --line-soft background draws the separators
        // between cells, in any number of columns.
        "grid gap-px overflow-hidden rounded-md border border-line bg-line-soft [grid-template-columns:repeat(auto-fit,minmax(148px,1fr))]",
        className,
      )}
    >
      {items.map((item) => (
        <div
          key={item.key}
          data-kpi={item.key}
          className="flex flex-col gap-1.5 bg-surface px-5 py-[18px]"
        >
          <dt className="text-[10.5px] uppercase tracking-[.18em] text-ink-soft">{item.label}</dt>
          <dd className="font-heading text-[36px] leading-none lining-nums tabular-nums">{item.value}</dd>
          {item.link ? (
            <dd className="text-[12.5px]">
              <Link href={item.link.href}>{item.link.label}</Link>
            </dd>
          ) : null}
        </div>
      ))}
    </dl>
  );
}
