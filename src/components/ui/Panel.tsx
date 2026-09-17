import type { HTMLAttributes } from "react";
import { cx } from "./cx";

export type PanelProps = HTMLAttributes<HTMLDivElement>;

export function Panel({ className, ...props }: PanelProps) {
  return (
    <div
      className={cx("rounded-md border border-line bg-surface p-[22px]", className)}
      {...props}
    />
  );
}
