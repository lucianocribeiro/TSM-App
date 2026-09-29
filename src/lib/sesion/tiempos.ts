// Session inactivity (PRD 3, session rules). Every duration in one place.

// No user activity for this long closes the session (client and server).
export const INACTIVIDAD_MS = 15 * 60 * 1000;
// The warning opens this long after the last activity (2 minutes before).
export const AVISO_MS = 13 * 60 * 1000;
// Real input is recorded, shared with other tabs and reported to the server
// at most this often.
export const ACTIVIDAD_THROTTLE_MS = 30 * 1000;
// The server re-signs the activity marker only when it is at least this old,
// so not every request sets a cookie.
export const MARCA_RENOVAR_MS = 30 * 1000;
// Tolerance for a marker stamped slightly in the future (clock steps).
export const MARCA_DESFASE_MS = 60 * 1000;
