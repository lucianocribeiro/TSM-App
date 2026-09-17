import { cx } from "./cx";

export type StatusBadgeTone = "active" | "secondary";

export type StatusBadgeProps = {
  label: string;
  tone?: StatusBadgeTone;
  className?: string;
};

export function StatusBadge({ label, tone = "active", className }: StatusBadgeProps) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-[7px] rounded-md border border-line px-[9px] py-[3px] text-[11.5px]",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          "size-1.5 rounded-full",
          tone === "active" ? "bg-accent" : "bg-ink-soft",
        )}
      />
      {label}
    </span>
  );
}
