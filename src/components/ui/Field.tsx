import { useId } from "react";
import { Input, type InputProps } from "./Input";

export type FieldProps = Omit<InputProps, "id"> & {
  label: string;
  error?: string;
};

export function Field({ label, error, ...inputProps }: FieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-[10.5px] uppercase tracking-[.16em] text-ink-soft"
      >
        {label}
      </label>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...inputProps}
      />
      {error ? (
        <p id={errorId} className="text-[12.5px] italic text-accent-deep">
          {error}
        </p>
      ) : null}
    </div>
  );
}
