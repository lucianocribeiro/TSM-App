"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { cambiarPassword } from "@/lib/auth/actions";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password";
import { copy } from "@/lib/copy/es-AR";

export function CambiarPasswordForm() {
  const [state, formAction, pending] = useActionState(cambiarPassword, null);

  return (
    <form action={formAction} className="mt-6 flex flex-col gap-4">
      <Field
        label={copy.password.nuevaLabel}
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={PASSWORD_MIN_LENGTH}
        required
      />
      <Field
        label={copy.password.confirmacionLabel}
        name="confirmacion"
        type="password"
        autoComplete="new-password"
        minLength={PASSWORD_MIN_LENGTH}
        required
      />
      <p className="text-[12.5px] italic text-ink-soft">{copy.password.hint}</p>
      {state && !state.ok ? (
        <p role="alert" className="text-[12.5px] italic text-accent-deep">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="mt-2 w-full">
        {pending ? copy.password.submitting : copy.password.submit}
      </Button>
    </form>
  );
}
