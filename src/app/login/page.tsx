import { redirect } from "next/navigation";
import { Logo } from "@/components/ui/Logo";
import { Panel } from "@/components/ui/Panel";
import { CUENTA_INACTIVA, CUENTA_NO_VERIFICADA, CUENTA_PARAM } from "@/lib/auth/gate";
import { getSessionUser } from "@/lib/auth/session";
import { copy } from "@/lib/copy/es-AR";
import { LoginForm } from "./LoginForm";

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const user = await getSessionUser();
  // A session the gate rejects (inactive, or the account cannot be verified)
  // stays here: the proxy clears it.
  if (user?.cuenta?.estadoCuenta === "activa") {
    redirect("/mi-legajo");
  }

  // Set by the account gate when it ends a session.
  const motivo = (await searchParams)[CUENTA_PARAM];
  const initialError =
    motivo === CUENTA_INACTIVA
      ? copy.auth.errors.cuentaInactiva
      : motivo === CUENTA_NO_VERIFICADA
        ? copy.auth.errors.cuentaNoVerificada
        : undefined;

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <Panel className="w-full max-w-[380px] shadow-panel">
        <div className="flex flex-col items-center gap-4">
          <Logo alt={copy.app.logoAlt} size={88} preload />
          <h1 className="text-center text-[32px] font-normal leading-[1.08]">
            {copy.auth.login.title}
          </h1>
        </div>
        <LoginForm initialError={initialError} />
      </Panel>
    </main>
  );
}
