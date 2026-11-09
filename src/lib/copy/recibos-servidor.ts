import "server-only";

// Receipts texts used only on the server (F2-07). They are written into
// generated files, not rendered on a screen, so they stay out of the shared
// copy (./es-AR.ts), which every route ships.

export type CopyRecibosServidor = {
  // The line stamped under the signature on the last page of a signed
  // receipt (RF-17). {fecha} is dd/mm/aaaa and {hora} HH:mm, both in
  // America/Argentina/Buenos_Aires.
  estampaFirma: string;
  // The name on the stamp when the employee's legajo has neither surname nor
  // name (F2-05, decision 12): never an id or an email.
  nombreSinLegajo: string;
};

export const copyRecibosServidor: CopyRecibosServidor = {
  estampaFirma: "Firmado electrónicamente por {nombre} el {fecha} a las {hora} (hora de Argentina)",
  nombreSinLegajo: "la persona titular de la cuenta (sin nombre en el legajo)",
};
