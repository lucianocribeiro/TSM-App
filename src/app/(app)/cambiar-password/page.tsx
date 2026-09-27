import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { getSessionUser } from "@/lib/auth/session";
import { copy } from "@/lib/copy/es-AR";
import { CambiarPasswordForm } from "./CambiarPasswordForm";

// Password change.
// Forced (PRD US-9): the only page reachable while the user has a temporary
// password; the proxy and the app layout enforce that.
// Voluntary: any signed-in user, an Admin included, changes their own
// password here (an Admin cannot set a temporary password on themselves).
export default async function CambiarPasswordPage() {
  const user = await getSessionUser();
  const forced = user?.debeCambiarPassword ?? false;

  return (
    <>
      <PageHeader kicker={copy.password.kicker} title={copy.password.title} />
      <div className="px-[34px] pb-10 pt-[26px]">
        <Panel className="max-w-[440px]">
          <p className="text-ink-soft">
            {forced ? copy.password.intro : copy.password.introVoluntaria}
          </p>
          <CambiarPasswordForm pedirActual={!forced} />
        </Panel>
      </div>
    </>
  );
}
