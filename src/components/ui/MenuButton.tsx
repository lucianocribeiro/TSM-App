import { cx } from "./cx";

export type MenuButtonProps = {
  // Accessible name: what pressing it does ("Abrir menú", "Ocultar menú").
  label: string;
  // Whether the menu it controls is shown.
  expanded: boolean;
  // id of the menu element.
  controls: string;
  onClick: () => void;
  className?: string;
};

// The hamburger button that shows or hides a menu. Same square, border and
// ink as the bell (BellLink).
export function MenuButton({ label, expanded, controls, onClick, className }: MenuButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onClick}
      className={cx(
        "inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md border border-line bg-rail text-rail-ink transition-colors hover:border-accent hover:text-accent-deep",
        className,
      )}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M4 7h16M4 12h16M4 17h16" />
      </svg>
    </button>
  );
}
