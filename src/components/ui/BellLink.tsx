import Link from "next/link";
import { cx } from "./cx";

export type BellLinkProps = {
  href: string;
  // Accessible name, with the exact count.
  label: string;
  // Badge text ("3", "9+"); no badge when null.
  badge: string | null;
  onClick?: () => void;
  className?: string;
};

// A bell icon that links somewhere, with an optional count badge. Neutral
// (ink) with no badge; accent badge when there is something to see.
export function BellLink({ href, label, badge, onClick, className }: BellLinkProps) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      onClick={onClick}
      data-testid="campana"
      className={cx(
        "relative inline-flex size-9 items-center justify-center rounded-md border border-line text-rail-ink no-underline transition-colors hover:border-accent hover:text-accent-deep",
        className,
      )}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Z" strokeLinejoin="round" />
        <path d="M10 20.5a2 2 0 0 0 4 0" strokeLinecap="round" />
      </svg>
      {badge ? (
        <span
          data-testid="campana-conteo"
          className="absolute -right-2 -top-2 min-w-5 rounded-full border border-accent bg-rail px-1 text-center text-[10.5px] font-semibold leading-[18px] text-accent-deep tabular-nums"
        >
          {badge}
        </span>
      ) : null}
    </Link>
  );
}
