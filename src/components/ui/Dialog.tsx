"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { cx } from "./cx";

export type DialogProps = {
  open: boolean;
  // Called on Escape, on the backdrop and by the caller's own buttons.
  onClose: () => void;
  title: string;
  children: ReactNode;
  // Buttons, right-aligned below the content.
  footer?: ReactNode;
  className?: string;
};

// Modal dialog on the native <dialog> element: the browser traps focus, makes
// the rest of the page inert and closes it on Escape.
export function Dialog({ open, onClose, title, children, footer, className }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself.
        if (event.target === event.currentTarget) onClose();
      }}
      className={cx(
        "m-auto w-[calc(100%-32px)] max-w-[480px] rounded-md border border-line bg-surface p-0 text-ink shadow-panel backdrop:bg-ink/40",
        className,
      )}
    >
      {open ? (
        <div className="flex flex-col gap-4 p-[22px]">
          <h2 id={titleId} className="text-[26px] font-normal leading-[1.1]">
            {title}
          </h2>
          {children}
          {footer ? <div className="mt-2 flex flex-wrap justify-end gap-2">{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}
