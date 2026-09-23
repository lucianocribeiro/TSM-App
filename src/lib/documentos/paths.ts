import {
  DOCUMENTO_MIME_TYPES,
  isDocumentoMimeType,
  isDocumentoTipo,
  type DocumentoMimeType,
  type DocumentoPathExtension,
  type DocumentoTipo,
} from "./tipos";

// Object paths in the legajo-docs bucket: <profile_id>/<tipo>/<uuid>.<ext>.
// Mirrors public.is_valid_legajo_doc_path in the database, which the storage
// policies enforce. Pure functions: invalid input returns null.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type DocumentoPath = {
  profileId: string;
  tipo: DocumentoTipo;
  fileId: string;
  extension: DocumentoPathExtension;
  mimeType: DocumentoMimeType;
};

export type BuildDocumentoPathInput = {
  profileId: string;
  tipo: string;
  fileId: string;
  mimeType: string;
};

function isUuid(value: string): boolean {
  return UUID.test(value);
}

function mimeTypeForExtension(extension: string): DocumentoMimeType | null {
  for (const [mimeType, config] of Object.entries(DOCUMENTO_MIME_TYPES)) {
    if (config.pathExtension === extension) return mimeType as DocumentoMimeType;
  }
  return null;
}

// Builds the path for a new object. fileId is a fresh UUID from the caller
// (crypto.randomUUID()); the extension comes from the MIME type.
export function buildDocumentoPath(input: BuildDocumentoPathInput): string | null {
  const profileId = input.profileId.toLowerCase();
  const fileId = input.fileId.toLowerCase();
  if (!isUuid(profileId) || !isUuid(fileId)) return null;
  if (!isDocumentoTipo(input.tipo)) return null;
  if (!isDocumentoMimeType(input.mimeType)) return null;

  const extension = DOCUMENTO_MIME_TYPES[input.mimeType].pathExtension;
  return `${profileId}/${input.tipo}/${fileId}.${extension}`;
}

// Parses a stored path. When mimeType is given, the path extension must match it.
export function parseDocumentoPath(
  path: string,
  options: { mimeType?: string } = {},
): DocumentoPath | null {
  const segments = path.split("/");
  if (segments.length !== 3) return null;

  const [profileId, tipo, fileName] = segments;
  if (!isUuid(profileId) || !isDocumentoTipo(tipo)) return null;

  const dot = fileName.lastIndexOf(".");
  if (dot === -1) return null;
  const fileId = fileName.slice(0, dot);
  const extension = fileName.slice(dot + 1);
  if (!isUuid(fileId)) return null;

  const mimeType = mimeTypeForExtension(extension);
  if (!mimeType) return null;
  if (options.mimeType !== undefined && options.mimeType !== mimeType) return null;

  return {
    profileId,
    tipo,
    fileId,
    extension: DOCUMENTO_MIME_TYPES[mimeType].pathExtension,
    mimeType,
  };
}
