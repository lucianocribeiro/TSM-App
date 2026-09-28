import { useId, type TextareaHTMLAttributes } from "react";
import { cx } from "./cx";

export type TextAreaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> & {
  label: string;
  // Helper line under the field (for example the length limit).
  hint?: string;
  error?: string;
};

// Label + multi-line input, styled like Field, with the same error display.
export function TextArea({ label, hint, error, className, rows = 4, ...props }: TextAreaProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[10.5px] uppercase tracking-[.16em] text-ink-soft">
        {label}
      </label>
      <textarea
        id={id}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cx(
          "w-full resize-y rounded-md border border-line bg-transparent px-3 py-[9px] text-[14px] text-ink outline-none transition-colors focus:border-accent aria-invalid:border-accent",
          className,
        )}
        {...props}
      />
      {hint ? (
        <p id={hintId} className="text-[12.5px] italic text-ink-soft">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-[12.5px] italic text-accent-deep">
          {error}
        </p>
      ) : null}
    </div>
  );
}
