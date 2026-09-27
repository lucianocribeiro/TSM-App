import type { ReactNode } from "react";
import { cx } from "./cx";

export type BannerTone = "info" | "attention";

export type BannerProps = {
  tone?: BannerTone;
  children: ReactNode;
  // Buttons, to the right of the text (below it on narrow screens).
  actions?: ReactNode;
  className?: string;
};

// Page-level notice. "attention" is for something waiting on the user or on
// review (accent border and tint); "info" is neutral.
export function Banner({ tone = "info", children, actions, className }: BannerProps) {
  return (
    <div
      role="status"
      className={cx(
        "flex flex-wrap items-center justify-between gap-3 rounded-md border px-[18px] py-[14px] text-[14px]",
        tone === "attention" ? "border-accent bg-accent-soft text-ink" : "border-line bg-surface text-ink-soft",
        className,
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
