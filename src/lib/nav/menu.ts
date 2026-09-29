// Whether the side menu is shown or hidden on wide screens (900px and up),
// remembered per browser in a cookie so the page renders in that state from
// the server, without a flash. Below 900px the menu always starts closed
// behind the top bar button.

export const MENU_COOKIE = "tsm-menu";

export const ESTADOS_MENU = ["visible", "oculto"] as const;
export type EstadoMenu = (typeof ESTADOS_MENU)[number];

export const ESTADO_MENU_INICIAL: EstadoMenu = "visible";

// One year, in seconds.
export const MENU_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function parseEstadoMenu(value: string | undefined | null): EstadoMenu {
  return value === "oculto" ? "oculto" : ESTADO_MENU_INICIAL;
}

export function menuCookieString(estado: EstadoMenu): string {
  return `${MENU_COOKIE}=${estado}; Path=/; Max-Age=${MENU_COOKIE_MAX_AGE}; SameSite=Lax`;
}
