// How an Admin replaces a current (approved) document (F1-09B): keep it as
// 'reemplazado' in the legajo's history, or delete it and its file for good.
export const MODOS_REEMPLAZO = ["conservar", "definitivo"] as const;
export type ModoReemplazo = (typeof MODOS_REEMPLAZO)[number];
