import type { ReactNode } from "react";

export type PageHeaderProps = {
  kicker: string;
  title: string;
  actions?: ReactNode;
};

export function PageHeader({ kicker, title, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line px-[34px] pb-4 pt-[26px]">
      <div>
        <p className="text-[10.5px] uppercase tracking-[.20em] text-ink-soft">
          {kicker}
        </p>
        <h1 className="mt-1.5 text-[38px] font-normal leading-[1.08]">{title}</h1>
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}
