// Carga de recibos texts, Admin only (F2-04). Kept out of the shared copy
// (./es-AR.ts), which every route ships: only the /recibos route and the
// receipts Admin modules import this file. ESLint refuses the import from Mi
// Legajo and the shared modules, and scripts/bundle-mi-legajo.mjs checks the
// built chunks.

import type { Database } from "@/lib/supabase/database.types";

type PeriodoEstado = Database["public"]["Enums"]["recibo_periodo_estado"];

export type MotivoNoVerificableCopy = "sin_texto" | "ilegible" | "demasiado_grande" | "tiempo_agotado";
export type EstadoFilaRecibo = "sin_recibo" | "cargado" | "firmado";
// Estado de firmas (F2-06): the state of an employee in a period.
export type EstadoFirmaFila = "sin_recibo" | "pendiente" | "firmado";
export type FiltroEstadoFirma = "todos" | EstadoFirmaFila;
type MotivoOverride = Database["public"]["Enums"]["recibo_override_motivo"];

type Confirmacion = { title: string; body: string; confirmar: string };
type DialogoDni = { title: string; body: string };

export type CopyRecibos = {
  kicker: string;
  title: string;
  intro: string;
  periodos: {
    label: string;
    vacio: string;
    // {periodo} MM/AAAA, {estado} the state label.
    opcion: string;
    nuevo: string;
    estados: Record<PeriodoEstado, string>;
  };
  nuevoPeriodo: {
    title: string;
    intro: string;
    mes: string;
    anio: string;
    crear: string;
    creando: string;
    meses: readonly string[];
  };
  acciones: { publicar: string; cerrar: string; reabrir: string; procesando: string };
  confirmaciones: { publicar: Confirmacion; cerrar: Confirmacion; reabrir: Confirmacion };
  avisos: { creado: string; publicado: string; cerrado: string; reabierto: string };
  banners: { borrador: string; cerrado: string };
  // {con} with a receipt, {sin} without.
  conteo: string;
  tabla: { label: string; empleado: string; estado: string; archivo: string; sinEmpleados: string };
  estadosFila: Record<EstadoFilaRecibo, string>;
  fila: {
    // The drop zone's accessible name.
    zona: string;
    soltar: string;
    elegir: string;
    reemplazar: string;
    ver: string;
    subiendo: string;
    verificando: string;
    cargado: string;
    descartado: string;
  };
  dialogos: {
    dniNoEncontrado: DialogoDni;
    // {motivo}: one of motivosNoVerificable.
    noVerificable: DialogoDni;
    motivosNoVerificable: Record<MotivoNoVerificableCopy, string>;
    sinDni: DialogoDni;
    aceptar: string;
    rechazar: string;
    reemplazo: { title: string; body: string; firmado: string; confirmar: string };
  };
  // The two views of /recibos (F2-06, decision 5).
  vistas: { label: string; carga: string; estado: string };
  estado: EstadoFirmasCopy;
  common: { cancelar: string };
  usuarioNoDisponible: string;
  errors: {
    tipo: string;
    muyGrande: string;
    vacio: string;
    contenido: string;
    periodoCerrado: string;
    empleadoNoElegible: string;
    subidaFallo: string;
    registroFallo: string;
    limpiezaFallo: string;
    descarteFallo: string;
    dniCambio: string;
    conflicto: string;
    periodoExistente: string;
    periodoInvalido: string;
    periodoInexistente: string;
    transicionInvalida: string;
    accionFallo: string;
    verFallo: string;
    listaFallo: string;
  };
};

export type EstadoFirmasCopy = {
  title: string;
  intro: string;
  // {firmados}, {pendientes}, {sinRecibo}.
  conteo: string;
  filtros: { label: string; opciones: Record<FiltroEstadoFirma, string> };
  banners: { borrador: string };
  tabla: {
    label: string;
    empleado: string;
    estado: string;
    firmado: string;
    acciones: string;
    sinEmpleados: string;
    sinResultados: string;
  };
  estados: Record<EstadoFirmaFila, string>;
  // {fecha}: dd/mm/aaaa HH:mm.
  firmadoEl: string;
  inactiva: string;
  detalle: string;
  // {nombre}: the accessible name of a row's Detalle button.
  detalleDe: string;
  dialogo: {
    // {nombre}, {periodo}.
    title: string;
    cargando: string;
    cerrar: string;
    ver: string;
    descargar: string;
    actual: {
      title: string;
      estado: string;
      cargado: string;
      cargadoPor: string;
    };
    firma: {
      title: string;
      sinFirma: string;
      firmadoAt: string;
      version: string;
      // {version}.
      versionValor: string;
      imagen: string;
      imagenFallo: string;
    };
    dni: {
      title: string;
      vacio: string;
      motivo: string;
      quien: string;
      cuando: string;
      motivos: Record<MotivoOverride, string>;
    };
    reemplazos: {
      title: string;
      vacio: string;
      // {n}: the replaced file's number, oldest first.
      item: string;
      quien: string;
      cuando: string;
      estadoAlReemplazo: string;
      firmadoAt: string;
      cargado: string;
      estados: Record<"pendiente" | "firmado", string>;
    };
  };
  errors: { listaFallo: string; detalleFallo: string; verFallo: string; firmaFallo: string };
};

export const copyRecibos: CopyRecibos = {
  kicker: "Recibos de sueldo",
  title: "Carga de recibos",
  intro: "Elegí un período y cargá el recibo de cada empleado. Cada archivo se controla con el DNI del legajo.",
  periodos: {
    label: "Período",
    vacio: "Todavía no hay períodos. Creá el primero para empezar a cargar recibos.",
    opcion: "{periodo} · {estado}",
    nuevo: "Nuevo período",
    estados: { borrador: "Borrador", publicado: "Publicado", cerrado: "Cerrado" },
  },
  nuevoPeriodo: {
    title: "Nuevo período",
    intro: "El período se crea como borrador: los empleados no lo ven hasta que lo publiques.",
    mes: "Mes",
    anio: "Año",
    crear: "Crear período",
    creando: "Creando…",
    meses: [
      "Enero",
      "Febrero",
      "Marzo",
      "Abril",
      "Mayo",
      "Junio",
      "Julio",
      "Agosto",
      "Septiembre",
      "Octubre",
      "Noviembre",
      "Diciembre",
    ],
  },
  acciones: { publicar: "Publicar", cerrar: "Cerrar período", reabrir: "Reabrir", procesando: "Guardando…" },
  confirmaciones: {
    publicar: {
      title: "Publicar {periodo}",
      body: "Los empleados van a ver los recibos de este período y van a poder firmarlos. ¿Querés publicarlo?",
      confirmar: "Publicar",
    },
    cerrar: {
      title: "Cerrar {periodo}",
      body: "Con el período cerrado no se pueden cargar ni reemplazar recibos. Los empleados los siguen viendo. Podés reabrirlo más adelante.",
      confirmar: "Cerrar período",
    },
    reabrir: {
      title: "Reabrir {periodo}",
      body: "El período vuelve a estar publicado y vas a poder cargar y reemplazar recibos otra vez.",
      confirmar: "Reabrir",
    },
  },
  avisos: {
    creado: "Creaste el período {periodo}.",
    publicado: "Publicaste el período {periodo}.",
    cerrado: "Cerraste el período {periodo}.",
    reabierto: "Reabriste el período {periodo}.",
  },
  banners: {
    borrador: "Este período es un borrador: los empleados todavía no lo ven. Publicalo cuando termines de cargar los recibos.",
    cerrado: "Este período está cerrado: no se pueden cargar ni reemplazar recibos. Reabrilo si necesitás hacer cambios.",
  },
  conteo: "Con recibo: {con} · Sin recibo: {sin}",
  tabla: {
    label: "Recibos del período",
    empleado: "Empleado",
    estado: "Estado",
    archivo: "Archivo",
    sinEmpleados: "No hay empleados con la cuenta activa para cargarles recibos.",
  },
  estadosFila: { sin_recibo: "Sin recibo", cargado: "Cargado", firmado: "Firmado" },
  fila: {
    zona: "Recibo de {nombre}: soltá el PDF acá o elegí el archivo",
    soltar: "Soltá el PDF acá",
    elegir: "Elegir archivo",
    reemplazar: "Reemplazar",
    ver: "Ver",
    subiendo: "Subiendo…",
    verificando: "Verificando el DNI…",
    cargado: "Recibo cargado.",
    descartado: "Descartaste el archivo.",
  },
  dialogos: {
    dniNoEncontrado: {
      title: "No encontramos el DNI",
      body: "No encontramos el DNI de {nombre} en el archivo. ¿Estás seguro de que es el recibo correcto?",
    },
    noVerificable: {
      title: "No pudimos verificar el DNI",
      body: "No pudimos verificar el DNI de {nombre}: {motivo}. ¿Querés cargarlo igual?",
    },
    motivosNoVerificable: {
      sin_texto: "el archivo no tiene texto para leer (por ejemplo, si es un recibo escaneado)",
      ilegible: "el archivo está protegido con contraseña o dañado",
      demasiado_grande: "el archivo tiene más de 20 páginas",
      tiempo_agotado: "el archivo tardó demasiado en leerse",
    },
    sinDni: {
      title: "Sin DNI en el legajo",
      body: "{nombre} no tiene un DNI válido cargado en su legajo, así que no pudimos verificar el recibo. ¿Querés cargarlo igual?",
    },
    aceptar: "Aceptar",
    rechazar: "Rechazar",
    reemplazo: {
      title: "Reemplazar recibo",
      body: "{nombre} ya tiene un recibo en {periodo}. Si continuás, se reemplaza y el anterior queda en el historial.",
      firmado: "Ese recibo ya está firmado: {nombre} va a tener que firmar el nuevo.",
      confirmar: "Reemplazar",
    },
  },
  vistas: { label: "Vistas de recibos", carga: "Carga", estado: "Estado de firmas" },
  estado: {
    title: "Estado de firmas",
    intro: "Elegí un período para ver quién firmó su recibo, quién lo tiene pendiente y a quién le falta cargarlo.",
    conteo: "Firmados: {firmados} · Pendientes: {pendientes} · Sin recibo: {sinRecibo}",
    filtros: {
      label: "Filtrar por estado",
      opciones: { todos: "Todos", firmado: "Firmados", pendiente: "Pendientes", sin_recibo: "Sin recibo" },
    },
    banners: { borrador: "Los empleados todavía no ven este período. Publicalo desde Carga cuando termines." },
    tabla: {
      label: "Estado de firmas del período",
      empleado: "Empleado",
      estado: "Estado",
      firmado: "Firmado el",
      acciones: "Acciones",
      sinEmpleados: "No hay empleados para mostrar en este período.",
      sinResultados: "No hay empleados con ese estado en este período.",
    },
    estados: { sin_recibo: "Sin recibo", pendiente: "Pendiente", firmado: "Firmado" },
    firmadoEl: "Firmado el {fecha}",
    inactiva: "Inactiva",
    detalle: "Detalle",
    detalleDe: "Detalle del recibo de {nombre}",
    dialogo: {
      title: "Recibo de {nombre} · {periodo}",
      cargando: "Cargando el detalle…",
      cerrar: "Cerrar",
      ver: "Ver",
      descargar: "Descargar",
      actual: {
        title: "Recibo actual",
        estado: "Estado",
        cargado: "Cargado el",
        cargadoPor: "Cargado por",
      },
      firma: {
        title: "Firma",
        sinFirma: "Todavía no firmó este recibo.",
        firmadoAt: "Firmado el",
        version: "Versión de la firma",
        versionValor: "Versión {version}",
        imagen: "Firma registrada usada en este recibo",
        imagenFallo: "No pudimos mostrar la imagen de la firma.",
      },
      dni: {
        title: "Verificación de DNI",
        vacio: "El DNI se verificó sin observaciones en cada carga.",
        motivo: "Motivo",
        quien: "Aceptado por",
        cuando: "Fecha",
        motivos: {
          dni_no_encontrado: "No se encontró el DNI en el archivo",
          no_verificable: "No se pudo verificar el DNI",
          sin_dni: "Sin DNI cargado en el legajo",
        },
      },
      reemplazos: {
        title: "Archivos reemplazados",
        vacio: "Este recibo no tuvo reemplazos.",
        item: "Archivo {n}",
        quien: "Reemplazado por",
        cuando: "Reemplazado el",
        estadoAlReemplazo: "Estado al reemplazarlo",
        firmadoAt: "Había sido firmado el",
        cargado: "Cargado el",
        estados: { pendiente: "Pendiente de firma", firmado: "Firmado" },
      },
    },
    errors: {
      listaFallo: "No pudimos cargar el estado de firmas. Actualizá la página para volver a intentar.",
      detalleFallo: "No pudimos cargar el detalle del recibo. Probá de nuevo.",
      verFallo: "No pudimos abrir el archivo. Probá de nuevo.",
      firmaFallo: "No pudimos abrir la imagen de la firma. Probá de nuevo.",
    },
  },
  common: { cancelar: "Cancelar" },
  usuarioNoDisponible: "Usuario no disponible",
  errors: {
    tipo: "El archivo tiene que ser un PDF.",
    muyGrande: "El archivo supera los 10 MB. Elegí uno más liviano.",
    vacio: "El archivo está vacío. Elegí otro.",
    contenido: "El archivo no es un PDF válido. Elegí otro.",
    periodoCerrado: "El período está cerrado. Reabrilo para cargar o reemplazar recibos.",
    empleadoNoElegible: "Esta persona no tiene una cuenta de empleado activa. Reactivá la cuenta para cargarle recibos.",
    subidaFallo: "No pudimos subir el archivo. Probá de nuevo.",
    registroFallo: "No pudimos guardar el recibo. Probá de nuevo.",
    limpiezaFallo:
      "No pudimos guardar el recibo, y el archivo subido no se pudo borrar ahora: se va a borrar solo más tarde. Probá de nuevo.",
    descarteFallo: "No pudimos borrar el archivo subido ahora: se va a borrar solo más tarde.",
    dniCambio: "El control del DNI dio otro resultado. Cargá el archivo de nuevo.",
    conflicto: "Se cargó otro recibo para esta persona al mismo tiempo. Actualizá la página y revisalo.",
    periodoExistente: "Ya existe un período para ese mes.",
    periodoInvalido: "Elegí un mes y un año válidos.",
    periodoInexistente: "No encontramos el período. Actualizá la página.",
    transicionInvalida: "El período cambió de estado. Actualizá la página y probá de nuevo.",
    accionFallo: "No pudimos completar la acción. Probá de nuevo.",
    verFallo: "No pudimos abrir el recibo. Probá de nuevo.",
    listaFallo: "No pudimos cargar los recibos. Actualizá la página para volver a intentar.",
  },
};
