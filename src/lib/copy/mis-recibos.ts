// Mis Recibos texts (F2-05), the employee's receipts screen. Only the
// /mis-recibos route and its server modules import this file. The Admin
// receipts copy (./recibos.ts) never reaches this route (ESLint Admin-only
// rule and bundle check).

export type CopyMisRecibos = {
  kicker: string;
  title: string;
  intro: string;
  vacio: { title: string; body: string };
  lista: { label: string; periodo: string; firmadoEl: string };
  estados: { pendiente: string; firmado: string };
  acciones: { ver: string; firmar: string; descargar: string; firmando: string; abriendo: string };
  firmar: { title: string; declaracion: string; tuFirma: string; confirmar: string; exito: string };
  miFirma: {
    title: string;
    intro: string;
    sinFirma: string;
    cambiar: string;
    registrar: string;
    nota: string;
    previewAlt: string;
    guardada: string;
  };
  dibujo: {
    title: string;
    intro: string;
    canvasLabel: string;
    borrar: string;
    guardar: string;
    guardando: string;
    minimo: string;
  };
  common: { cancelar: string };
  errors: {
    verFallo: string;
    descargaNoDisponible: string;
    noEncontrado: string;
    yaFirmado: string;
    horaInvalida: string;
    firmarFallo: string;
    limpiezaFallo: string;
    firmaTipo: string;
    firmaMuyGrande: string;
    firmaVacia: string;
    firmaContenido: string;
    firmaMedidas: string;
    firmaFallo: string;
    firmaLimpiezaFallo: string;
    descarteFallo: string;
    accionFallo: string;
    listaFallo: string;
  };
};

export const copyMisRecibos: CopyMisRecibos = {
  kicker: "Recibos de sueldo",
  title: "Mis Recibos",
  intro: "Acá ves tus recibos de sueldo. Firmalos para confirmar que los recibiste; una vez firmados, podés descargarlos.",
  vacio: {
    title: "Todavía no tenés recibos",
    body: "Cuando se publique un recibo tuyo, lo vas a ver acá.",
  },
  lista: {
    label: "Tus recibos",
    periodo: "Recibo {periodo}",
    firmadoEl: "Firmado el {fecha} a las {hora}",
  },
  estados: { pendiente: "Pendiente de firma", firmado: "Firmado" },
  acciones: { ver: "Ver", firmar: "Firmar", descargar: "Descargar", firmando: "Firmando…", abriendo: "Abriendo…" },
  firmar: {
    title: "Firmar el recibo {periodo}",
    declaracion: "Al firmar, confirmás que recibiste este recibo de sueldo.",
    tuFirma: "Tu firma",
    confirmar: "Firmar",
    exito: "Firmaste el recibo {periodo}. Ya podés descargarlo.",
  },
  miFirma: {
    title: "Mi firma",
    intro: "Es la firma que se estampa al pie de los recibos que firmás.",
    sinFirma: "Todavía no registraste tu firma. Vas a dibujarla la primera vez que firmes un recibo.",
    cambiar: "Cambiar mi firma",
    registrar: "Dibujar mi firma",
    nota: "Los recibos que ya firmaste conservan la firma con la que los firmaste.",
    previewAlt: "Tu firma registrada",
    guardada: "Guardaste tu firma.",
  },
  dibujo: {
    title: "Dibujá tu firma",
    intro: "Firmá dentro del recuadro con el mouse, el dedo o un lápiz.",
    canvasLabel: "Recuadro para dibujar tu firma",
    borrar: "Borrar",
    guardar: "Guardar firma",
    guardando: "Guardando…",
    minimo: "Dibujá tu firma completa para poder guardarla.",
  },
  common: { cancelar: "Cancelar" },
  errors: {
    verFallo: "No pudimos abrir el recibo. Probá de nuevo.",
    descargaNoDisponible: "Vas a poder descargar el recibo una vez que lo firmes.",
    noEncontrado: "No encontramos el recibo. Actualizá la página.",
    yaFirmado: "Este recibo ya está firmado.",
    horaInvalida: "No pudimos registrar la hora de la firma. Probá de nuevo.",
    firmarFallo: "No pudimos firmar el recibo. Probá de nuevo.",
    limpiezaFallo: "No pudimos firmar el recibo, y el archivo preparado no se pudo borrar ahora: se va a borrar solo más tarde. Probá de nuevo.",
    firmaTipo: "La firma tiene que ser una imagen PNG.",
    firmaMuyGrande: "La imagen de la firma supera 1 MB. Dibujala de nuevo.",
    firmaVacia: "La firma está vacía. Dibujala de nuevo.",
    firmaContenido: "La imagen de la firma no es válida. Dibujala de nuevo.",
    firmaMedidas: "La imagen de la firma tiene un tamaño fuera de lo esperado. Dibujala de nuevo.",
    firmaFallo: "No pudimos guardar tu firma. Probá de nuevo.",
    firmaLimpiezaFallo: "No pudimos guardar tu firma, y la imagen subida no se pudo borrar ahora: se va a borrar sola más tarde. Probá de nuevo.",
    descarteFallo: "No pudimos borrar la imagen subida ahora: se va a borrar sola más tarde.",
    accionFallo: "No pudimos completar la acción. Probá de nuevo.",
    listaFallo: "No pudimos cargar tus recibos. Actualizá la página para volver a intentar.",
  },
};
