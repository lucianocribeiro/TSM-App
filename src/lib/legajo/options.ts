// Option values from PRD section 5. Codes are stored in the database; display
// labels for codes come from the copy module when the UI is built.

// PRD 5.2: stored as the exact labels (database check constraint legajos_partido_valido).
export const PARTIDOS = [
  "General San Martín",
  "CABA",
  "Almirante Brown",
  "Avellaneda",
  "Berazategui",
  "Berisso",
  "Brandsen",
  "Campana",
  "Cañuelas",
  "Ensenada",
  "Escobar",
  "Esteban Echeverría",
  "Exaltación de la Cruz",
  "Ezeiza",
  "Florencio Varela",
  "General Las Heras",
  "General Rodríguez",
  "Hurlingham",
  "Ituzaingó",
  "José C. Paz",
  "La Matanza",
  "La Plata",
  "Lanús",
  "Lomas de Zamora",
  "Luján",
  "Malvinas Argentinas",
  "Marcos Paz",
  "Merlo",
  "Moreno",
  "Morón",
  "Pilar",
  "Presidente Perón",
  "Quilmes",
  "San Fernando",
  "San Isidro",
  "San Miguel",
  "San Vicente",
  "Tigre",
  "Tres de Febrero",
  "Vicente López",
  "Zárate",
  "Otro",
] as const;
export type Partido = (typeof PARTIDOS)[number];
export const PARTIDO_OTRO: Partido = "Otro";

// PRD 5.3 (enum public.estado_civil).
export const ESTADOS_CIVILES = [
  "soltero",
  "casado",
  "divorciado",
  "viudo",
  "union_convivencial",
] as const;
export type EstadoCivil = (typeof ESTADOS_CIVILES)[number];

// PRD 5.5 (enum public.estado_laboral). "en_licencia" arrives in Fase 3.
export const ESTADOS_LABORALES = ["activo", "en_prueba"] as const;
export type EstadoLaboral = (typeof ESTADOS_LABORALES)[number];
