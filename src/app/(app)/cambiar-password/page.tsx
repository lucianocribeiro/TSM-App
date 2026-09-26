import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { HOME_PATH } from "@/lib/auth/gate";
import { getSessionUser } from "@/lib/auth/session";
import { copy } from "@/lib/copy/es-AR";
import { CambiarPasswordForm } from "./CambiarPasswordForm";

// Forced password change (PRD US-9): the only page reachable while the user
// has a temporary password. The proxy and the app layout enforce that.
export default async function CambiarPasswordPage() {
  const user = await getSessionUser();
  if (!user?.debeCambiarPassword) {
    redirect(HOME_PATH);
  }

  return (
    <>
      <PageHeader kicker={copy.password.kicker} title={copy.password.title} />
      <div className="px-[34px] pb-10 pt-[26px]">
        <Panel className="max-w-[440px]">
          <p className="text-ink-soft">{copy.password.intro}</p>
          <CambiarPasswordForm />
        </Panel>
      </div>
    </>
  );
}
