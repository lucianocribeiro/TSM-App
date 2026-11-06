import "server-only";

// Object paths, owner first (F2-03):
//   recibos: <empleado_id>/<periodo_id>/<uuid>.pdf
//   firmas:  <empleado_id>/<version>-<uuid>.png
// The database checks the owner (and period) folder against the row
// (recibos_storage migration); the storage policies read the first folder.
// Pure functions: invalid input returns null. Lowercase UUIDs only, so no
// "..", no leading "/", no extra folder and no other extension can match.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UUID_FUENTE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const RECIBO_PATH = new RegExp(`^(${UUID_FUENTE})/(${UUID_FUENTE})/(${UUID_FUENTE})\\.pdf$`);
// Versions start at 1, without leading zeros.
const FIRMA_PATH = new RegExp(`^(${UUID_FUENTE})/([1-9][0-9]{0,8})-(${UUID_FUENTE})\\.png$`);

export type ReciboPath = { empleadoId: string; periodoId: string; fileId: string };
export type FirmaPath = { empleadoId: string; version: number; fileId: string };

function esUuid(value: string): boolean {
  return UUID.test(value);
}

// fileId is a fresh UUID from the caller (crypto.randomUUID()).
export function buildReciboPath(input: ReciboPath): string | null {
  const empleadoId = input.empleadoId.toLowerCase();
  const periodoId = input.periodoId.toLowerCase();
  const fileId = input.fileId.toLowerCase();
  if (!esUuid(empleadoId) || !esUuid(periodoId) || !esUuid(fileId)) return null;
  return `${empleadoId}/${periodoId}/${fileId}.pdf`;
}

export function parseReciboPath(path: string): ReciboPath | null {
  const match = RECIBO_PATH.exec(path);
  if (!match) return null;
  return { empleadoId: match[1], periodoId: match[2], fileId: match[3] };
}

export function buildFirmaPath(input: FirmaPath): string | null {
  const empleadoId = input.empleadoId.toLowerCase();
  const fileId = input.fileId.toLowerCase();
  if (!esUuid(empleadoId) || !esUuid(fileId)) return null;
  if (!Number.isInteger(input.version) || input.version < 1 || input.version > 999_999_999) return null;
  return `${empleadoId}/${input.version}-${fileId}.png`;
}

export function parseFirmaPath(path: string): FirmaPath | null {
  const match = FIRMA_PATH.exec(path);
  if (!match) return null;
  return { empleadoId: match[1], version: Number(match[2]), fileId: match[3] };
}
