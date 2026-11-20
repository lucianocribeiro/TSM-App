import Link from "next/link";
import { cx } from "./cx";

export type SegmentedNavItem = { key: string; href: string; label: string };

// Navigation between the views of one section, with the segmented filter's
// look (design system spec): a bordered group of links, the current one in
// --accent-deep and marked aria-current="page".
export function SegmentedNav({
  label,
  items,
  actual,
  className,
}: {
  // Accessible name of the navigation.
  label: string;
  items: readonly SegmentedNavItem[];
  // The key of the current view.
  actual: string;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={className}>
      <ul className="inline-flex max-w-full overflow-hidden rounded-md border border-line">
        {items.map((item, index) => {
          const activo = item.key === actual;
          return (
            <li key={item.key} className={cx(index > 0 && "border-l border-line-soft")}>
              <Link
                href={item.href}
                aria-current={activo ? "page" : undefined}
                className={cx(
                  "block px-[14px] py-[9px] text-[12.5px] no-underline transition-colors hover:bg-accent-soft",
                  activo ? "text-accent-deep" : "text-ink",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
