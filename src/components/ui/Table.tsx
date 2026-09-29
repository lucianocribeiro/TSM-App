import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cx } from "./cx";

// Bordered surface table with horizontal scroll on narrow screens (design
// system spec). Compose with the native thead, tbody and tr elements. The
// scroll box is positioned so absolutely positioned content in a cell (a
// visually hidden file input, for example) scrolls with the table instead of
// widening the page.
export function Table({ className, children, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="relative overflow-x-auto rounded-md border border-line bg-surface">
      <table className={cx("w-full border-collapse text-left text-[14px]", className)} {...props}>
        {children}
      </table>
    </div>
  );
}

export function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cx(
        "whitespace-nowrap border-b border-line px-[18px] py-[11px] text-[10.5px] font-normal uppercase tracking-[.16em] text-ink-soft",
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cx("border-b border-line-soft px-[18px] py-[14px] align-middle", className)}
      {...props}
    />
  );
}

// Row classes: hover highlight, and a pointer when the row opens something.
export function rowClassName(clickable: boolean): string {
  return cx("transition-colors hover:bg-accent-soft", clickable && "cursor-pointer");
}
