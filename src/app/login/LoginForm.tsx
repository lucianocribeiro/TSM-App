"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { login } from "@/lib/auth/actions";
import { copy } from "@/lib/copy/es-AR";

export function LoginForm() {
  const [state, formAction, pending] = useActionState(login, null);

  return (
    <form action={formAction} className="mt-6 flex flex-col gap-4">
      <Field
        label={copy.auth.login.emailLabel}
        name="email"
        type="email"
        autoComplete="email"
        required
      />
      <Field
        label={copy.auth.login.passwordLabel}
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />
      {state && !state.ok ? (
        <p role="alert" className="text-[12.5px] italic text-accent-deep">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="mt-2 w-full">
        {pending ? copy.auth.login.submitting : copy.auth.login.submit}
      </Button>
    </form>
  );
}
