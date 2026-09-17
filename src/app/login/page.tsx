import { redirect } from "next/navigation";
import { Logo } from "@/components/ui/Logo";
import { Panel } from "@/components/ui/Panel";
import { getSessionUser } from "@/lib/auth/session";
import { copy } from "@/lib/copy/es-AR";
import { LoginForm } from "./LoginForm";

export default async function LoginPage() {
  if (await getSessionUser()) {
    redirect("/mi-legajo");
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <Panel className="w-full max-w-[380px] shadow-panel">
        <div className="flex flex-col items-center gap-4">
          <Logo alt={copy.app.logoAlt} size={88} preload />
          <h1 className="text-center text-[32px] font-normal leading-[1.08]">
            {copy.auth.login.title}
          </h1>
        </div>
        <LoginForm />
      </Panel>
    </main>
  );
}
