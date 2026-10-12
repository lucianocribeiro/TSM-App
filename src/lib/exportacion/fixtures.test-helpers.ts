import type { CatalogoItem, CatalogoLista } from "@/lib/configuracion/listas";
import type { Database } from "@/lib/supabase/database.types";
import type { LegajoExportable } from "./planilla";

// Fictitious export data for the unit tests (CR-4).

type LegajoRow = Database["public"]["Tables"]["legajos"]["Row"];
type LaboralRow = Database["public"]["Tables"]["legajos_laborales"]["Row"];

let n = 0;
export function item(lista: CatalogoLista, nombre: string, extra: Partial<CatalogoItem> = {}): CatalogoItem {
  n += 1;
  return { id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, lista, nombre, areaId: null, posicion: n, activo: true, version: 1, ...extra };
}

export function legajoRow(extra: Partial<LegajoRow> = {}): LegajoRow {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    profile_id: "20000000-0000-4000-8000-000000000001",
    nombres: "Ana",
    apellido: "Prueba",
    dni: "30111222",
    nacionalidad: "Argentina",
    cuil: "20-30111222-3",
    fecha_nacimiento: "1990-01-15",
    calle_altura: "Calle Falsa 123",
    piso_depto: null,
    localidad: "Localidad",
    partido: "Tigre",
    partido_otro: null,
    telefono_celular: "11 4444-5555",
    email_personal: "ana@example.test",
    estado_civil: "union_convivencial",
    nombre_conyuge: null,
    tiene_hijos: true,
    grupo_sanguineo: "0+",
    alergias: "Ninguna",
    medicacion_habitual: "Ninguna",
    obra_social: "Obra Social de Prueba",
    numero_afiliado: "123",
    emergencia_nombre: "Contacto",
    emergencia_parentesco: "Madre",
    emergencia_domicilio: "Calle 2",
    emergencia_telefono: "11 5555-6666",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...extra,
  };
}

export function laboralRow(extra: Partial<LaboralRow> = {}): LaboralRow {
  return {
    legajo_id: "10000000-0000-4000-8000-000000000001",
    numero_legajo: "L-1",
    area_id: null,
    area_lista: "area",
    puesto_id: null,
    puesto_lista: "puesto",
    fecha_ingreso: "2020-03-01",
    estado_laboral: "activo",
    sucursal_id: null,
    sucursal_lista: "sucursal",
    tarea_id: null,
    tarea_lista: "tarea",
    convenio_id: null,
    convenio_lista: "convenio",
    categoria_id: null,
    categoria_lista: "categoria",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...extra,
  };
}

export function exportable(extra: Partial<LegajoExportable> = {}): LegajoExportable {
  return { legajo: legajoRow(), laboral: laboralRow(), hijos: [], ...extra };
}
