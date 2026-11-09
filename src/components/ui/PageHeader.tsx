import type { ReactNode } from "react";

export type PageHeaderProps = {
  kicker: string;
  title: string;
  actions?: ReactNode;
};

// Frozen while the page scrolls: below 900px it stops under the 56px top bar.
// Opaque, so the content passes behind it; under the top bar and the menus.
export function PageHeader({ kicker, title, actions }: PageHeaderProps) {
  return (
    <header
      data-testid="page-header"
      className="sticky top-14 z-20 flex flex-wrap items-end justify-between gap-4 border-b border-line bg-bg px-[34px] pb-4 pt-[26px] nav:top-0"
    >
      <div>
        <p className="text-[10.5px] uppercase tracking-[.20em] text-ink-soft">
          {kicker}
        </p>
        <h1 className="mt-1.5 text-[38px] font-normal leading-[1.08]">{title}</h1>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
