import { copy } from "@/lib/copy/es-AR";
import {
  DOCUMENTO_MIME_TYPES,
  isDocumentoMimeType,
  isDocumentoTipo,
  MAX_DOCUMENTO_BYTES,
  type DocumentoMimeType,
  type DocumentoTipo,
} from "./tipos";

// Shared upload validation for legajo documents (type, extension, MIME, size).
// The bucket and legajo_documentos enforce the same limits in the database;
// Server Actions validate with this first to return es-AR messages.

const messages = copy.documentos.validation;

// Same limit as the legajo_documentos_file_name constraint.
export const MAX_FILE_NAME_LENGTH = 255;

export type DocumentoUploadInput = {
  tipo: unknown;
  fileName: string | null | undefined;
  mimeType: string | null | undefined;
  sizeBytes: number | null | undefined;
};

export type ValidDocumentoUpload = {
  tipo: DocumentoTipo;
  fileName: string;
  mimeType: DocumentoMimeType;
  sizeBytes: number;
};

export type DocumentoUploadResult =
  | { ok: true; data: ValidDocumentoUpload }
  | { ok: false; error: string };

const ALLOWED_FILE_EXTENSIONS: readonly string[] = Object.values(
  DOCUMENTO_MIME_TYPES,
).flatMap((config) => config.fileExtensions);

function fileExtension(fileName: string): string | null {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) return null;
  return fileName.slice(dot + 1).toLowerCase();
}

export function validateDocumentoUpload(
  input: DocumentoUploadInput,
): DocumentoUploadResult {
  if (!isDocumentoTipo(input.tipo)) {
    return { ok: false, error: messages.tipoInvalid };
  }

  const fileName = input.fileName?.trim() ?? "";
  if (!fileName) {
    return { ok: false, error: messages.fileRequired };
  }
  if (fileName.length > MAX_FILE_NAME_LENGTH) {
    return { ok: false, error: messages.fileNameTooLong };
  }

  const sizeBytes = input.sizeBytes;
  if (
    sizeBytes === null ||
    sizeBytes === undefined ||
    !Number.isInteger(sizeBytes) ||
    sizeBytes <= 0
  ) {
    return { ok: false, error: messages.fileEmpty };
  }
  if (sizeBytes > MAX_DOCUMENTO_BYTES) {
    return { ok: false, error: messages.fileTooLarge };
  }

  const extension = fileExtension(fileName);
  const mimeType = input.mimeType;
  if (
    !isDocumentoMimeType(mimeType) ||
    !extension ||
    !ALLOWED_FILE_EXTENSIONS.includes(extension)
  ) {
    return { ok: false, error: messages.fileTypeNotAllowed };
  }

  const matchingExtensions: readonly string[] =
    DOCUMENTO_MIME_TYPES[mimeType].fileExtensions;
  if (!matchingExtensions.includes(extension)) {
    return { ok: false, error: messages.fileTypeMismatch };
  }

  return { ok: true, data: { tipo: input.tipo, fileName, mimeType, sizeBytes } };
}
