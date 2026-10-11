// Group E (Datos laborales) texts, Admin only (AUDCR2-01). Kept out of the
// shared copy (./es-AR.ts), which every route ships: only the Admin routes and
// modules import this file, so Mi Legajo's client bundle never carries group
// E labels. ESLint refuses the import from Mi Legajo and the shared modules,
// and scripts/bundle-mi-legajo.mjs checks the built chunks.

export type CopyLaborales = {
  grupo: string;
  campos: {
    numero_legajo: string;
    area: string;
    puesto: string;
    fecha_ingreso: string;
    antiguedad: string;
    estado_laboral: string;
    sucursal: string;
    tarea: string;
    convenio: string;
    categoria: string;
  };
  estados: {
    activo: string;
    en_prueba: string;
  };
  form: {
    antiguedadNota: string;
    // A required field's label.
    obligatorio: string;
    obligatoriosNota: string;
    // A list item that is no longer offered, kept by a legajo.
    inactivo: string;
    // The Puesto dropdown before an Área is chosen.
    elegirAreaPrimero: string;
  };
  // The Legajos list.
  listado: {
    busquedaPlaceholder: string;
    filtros: {
      estadoLaboral: string;
      area: string;
      sucursal: string;
      tarea: string;
    };
    columnas: {
      area: string;
      puesto: string;
      sucursal: string;
      tarea: string;
      estadoLaboral: string;
    };
    numeroLegajo: string;
  };
  errors: {
    numeroLegajoDuplicado: string;
  };
  // An Admin's own group E in Mi Legajo, read only (CR-4).
  propio: {
    nota: string;
    editar: string;
    fallo: string;
  };
};

export const copyLaborales = {
  grupo: "Datos laborales",
  campos: {
    numero_legajo: "Número de legajo",
    area: "Área",
    puesto: "Puesto",
    fecha_ingreso: "Fecha de ingreso",
    antiguedad: "Antigüedad",
    estado_laboral: "Estado laboral",
    sucursal: "Sucursal",
    tarea: "Tarea",
    convenio: "Convenio",
    categoria: "Categoría",
  },
  estados: {
    activo: "Activo",
    en_prueba: "En prueba",
  },
  form: {
    antiguedadNota: "La antigüedad se calcula a partir de la fecha de ingreso.",
    obligatorio: "{campo} *",
    obligatoriosNota: "Los datos marcados con * son obligatorios.",
    inactivo: "{nombre} (inactivo)",
    elegirAreaPrimero: "Elegí primero un área",
  },
  listado: {
    busquedaPlaceholder: "Nombre, DNI, CUIL o número de legajo",
    filtros: {
      estadoLaboral: "Estado laboral",
      area: "Área",
      sucursal: "Sucursal",
      tarea: "Tarea",
    },
    columnas: {
      area: "Área",
      puesto: "Puesto",
      sucursal: "Sucursal",
      tarea: "Tarea",
      estadoLaboral: "Estado laboral",
    },
    numeroLegajo: "Legajo {numero}",
  },
  errors: {
    numeroLegajoDuplicado: "Ese número de legajo ya está asignado a otro empleado.",
  },
  propio: {
    nota: "Solo lectura. Tus datos laborales se editan desde tu legajo en Legajos.",
    editar: "Editar en Legajos",
    fallo: "No pudimos cargar tus datos laborales. Intentá de nuevo.",
  },
} as const satisfies CopyLaborales;
