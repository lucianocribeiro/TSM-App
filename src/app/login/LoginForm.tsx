"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { login } from "@/lib/auth/actions";
import { copy } from "@/lib/copy/es-AR";

type LoginFormProps = {
  // Shown until the form is submitted (for example, an inactive account).
  initialError?: string;
};

export function LoginForm({ initialError }: LoginFormProps) {
  const [state, formAction, pending] = useActionState(login, null);
  const error = state ? (state.ok ? undefined : state.error) : initialError;

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
      {error ? (
        <p role="alert" className="text-[12.5px] italic text-accent-deep">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="mt-2 w-full">
        {pending ? copy.auth.login.submitting : copy.auth.login.submit}
      </Button>
    </form>
  );
}
