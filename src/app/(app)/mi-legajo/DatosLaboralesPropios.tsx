import "server-only";
import Link from "next/link";
import { buttonClassName } from "@/components/ui/Button";
import { LabelValueGrid } from "@/components/ui/LabelValueGrid";
import { Panel } from "@/components/ui/Panel";
import { listarItems } from "@/lib/configuracion/datos";
import { copyLaborales } from "@/lib/copy/laborales";
import { datosLaboralesVista } from "@/lib/legajo/laborales";
import { createClient } from "@/lib/supabase/server";

// An Admin's own group E in Mi Legajo, read only (CR-4), with a link to edit
// it in Legajos. A server component, rendered only when the viewer is an
// Admin (mi-legajo/page.tsx): its labels and values reach that Admin's
// response as rendered output, and nothing of it reaches Mi Legajo's client
// chunks ("server-only" refuses any client import). This file is the one
// explicit exception to the ESLint rule that keeps group E modules out of
// Mi Legajo (eslint.config.mjs); scripts/bundle-mi-legajo.mjs still checks
// the built chunks. Read with the Admin's session: RLS returns group E to an
// active Admin only.
export async function DatosLaboralesPropios({ profileId }: { profileId: string }) {
  const supabase = await createClient();
  const [{ data: legajo, error }, items] = await Promise.all([
    supabase.from("legajos").select("legajos_laborales(*)").eq("profile_id", profileId).maybeSingle(),
    listarItems(supabase),
  ]);
  const titleId = "grupo-E-propio-title";

  return (
    <Panel aria-labelledby={titleId} data-testid="grupo-E-propio">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={titleId} className="text-[24px] font-normal leading-[1.1]">
          {copyLaborales.grupo}
        </h2>
        <Link href={`/legajos/${profileId}`} className={buttonClassName("secondary")}>
          {copyLaborales.propio.editar}
        </Link>
      </div>
      <p className="mt-1 text-[12.5px] italic text-ink-soft">{copyLaborales.propio.nota}</p>
      <div className="mt-4">
        {error || !legajo || !items ? (
          <p role="alert" className="text-accent-deep">
            {copyLaborales.propio.fallo}
          </p>
        ) : (
          <LabelValueGrid
            items={datosLaboralesVista(legajo.legajos_laborales, items).map((dato) => ({
              key: dato.key,
              label: copyLaborales.campos[dato.key],
              value: dato.value,
            }))}
          />
        )}
      </div>
    </Panel>
  );
}
