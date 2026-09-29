"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useActionState, useState, type ReactNode } from "react";
import { BellLink } from "@/components/ui/BellLink";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Logo } from "@/components/ui/Logo";
import { MenuButton } from "@/components/ui/MenuButton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { etiquetaCampana, textoCampana } from "@/lib/aprobaciones/campana";
import { logout } from "@/lib/auth/actions";
import { CAMBIAR_PASSWORD_PATH } from "@/lib/auth/gate";
import { copy } from "@/lib/copy/es-AR";
import { menuCookieString, type EstadoMenu } from "@/lib/nav/menu";
import { isActivePath, type NavItem } from "@/lib/nav/nav";
import type { Theme } from "@/lib/theme/theme";
import { anunciarSalida } from "@/lib/sesion/salida";
import { SesionInactividad } from "./SesionInactividad";
import { usePendientesAprobacion } from "./usePendientesAprobacion";

type AppShellProps = {
  navItems: NavItem[];
  // Hidden during the forced password change, like the navigation.
  showCambiarPassword: boolean;
  userEmail: string;
  roleLabel: string;
  initialTheme: Theme;
  // Wide screens: the side menu shown or hidden (remembered per browser).
  initialMenu: EstadoMenu;
  // The Admin's pending approvals, for the bell. Null: no bell (not an Admin).
  pendientes: number | null;
  // A forced password change is pending (the inactivity limit then counts
  // only page loads).
  cambioPendiente: boolean;
  children: ReactNode;
};

const APROBACIONES_PATH = "/aprobaciones";

const SIDEBAR_ID = "app-sidebar";

export function AppShell({
  navItems,
  showCambiarPassword,
  userEmail,
  roleLabel,
  initialTheme,
  initialMenu,
  pendientes,
  cambioPendiente,
  children,
}: AppShellProps) {
  const pathname = usePathname();
  // Below 900px: the menu opened from the top bar.
  const [menuOpen, setMenuOpen] = useState(false);
  // 900px and up: the side menu hidden with the hamburger.
  const [menuOculto, setMenuOculto] = useState(initialMenu === "oculto");
  function alternarMenu() {
    const oculto = !menuOculto;
    document.cookie = menuCookieString(oculto ? "oculto" : "visible");
    setMenuOculto(oculto);
  }
  const [logoutState, logoutAction, logoutPending] = useActionState(logout, null);
  const totalPendientes = usePendientesAprobacion(pendientes);
  const campana =
    totalPendientes === null ? null : (
      <BellLink
        href={APROBACIONES_PATH}
        label={etiquetaCampana(totalPendientes)}
        badge={textoCampana(totalPendientes)}
        onClick={() => setMenuOpen(false)}
      />
    );

  return (
    <div className="min-h-screen">
      {/* Top bar, below 900px only: the logo in the center; the right side
          is taken by the corner buttons below. */}
      <div className="sticky top-0 z-30 grid grid-cols-[1fr_auto_1fr] items-center border-b border-line bg-rail px-4 py-2 text-rail-ink nav:hidden">
        <div />
        <Logo alt={copy.app.logoAlt} size={40} />
        <div />
      </div>

      {/* Top right corner, every width, left to right: the theme switch, the
          bell (Admin) and, below 900px, the menu button at the right end
          (inside the top bar). */}
      <div className="fixed right-4 top-2.5 z-40 flex items-center gap-2 nav:right-3 nav:top-3 nav:z-50">
        <ThemeToggle
          initialTheme={initialTheme}
          toDarkLabel={copy.theme.toDark}
          toLightLabel={copy.theme.toLight}
        />
        {campana}
        <div className="nav:hidden">
          <MenuButton
            label={menuOpen ? copy.common.closeMenu : copy.common.openMenu}
            expanded={menuOpen}
            controls={SIDEBAR_ID}
            onClick={() => setMenuOpen((open) => !open)}
          />
        </div>
      </div>

      {/* 900px and up: hides or shows the side menu. At the right of the
          menu's top row while it is shown (234px menu - 12px - 36px button);
          at the page's top left corner while it is hidden. */}
      <div className={cx("fixed top-3 z-50 hidden nav:block", menuOculto ? "left-3" : "left-[186px]")}>
        <MenuButton
          label={menuOculto ? copy.common.mostrarMenu : copy.common.ocultarMenu}
          expanded={!menuOculto}
          controls={SIDEBAR_ID}
          onClick={alternarMenu}
        />
      </div>

      {menuOpen ? (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-30 bg-overlay nav:hidden"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}

      <aside
        id={SIDEBAR_ID}
        className={cx(
          "fixed inset-y-0 left-0 z-40 w-[234px] flex-col overflow-y-auto border-r border-line bg-rail py-[26px] text-rail-ink",
          menuOpen ? "flex" : "hidden",
          menuOculto ? "nav:hidden" : "nav:flex",
        )}
      >
        <div className="flex justify-center px-[22px]">
          <Logo alt={copy.app.logoAlt} size={72} preload />
        </div>

        {navItems.length > 0 ? (
          <nav aria-label={copy.nav.label} className="mt-8">
            <ul>
              {navItems.map((item) => {
                const active = isActivePath(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setMenuOpen(false)}
                      className={cx(
                        "flex justify-center px-[22px] py-[11px] text-[14.5px] no-underline transition-colors hover:bg-accent-soft",
                        active ? "text-accent-deep" : "text-rail-ink",
                      )}
                    >
                      {/* Number and label centered as a unit; the active
                          item is underlined in the accent color. */}
                      <span
                        data-testid="nav-item"
                        className={cx(
                          "inline-flex items-baseline gap-3 border-b-2 pb-0.5",
                          active ? "border-accent" : "border-transparent",
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className="text-[10px] tracking-[.14em] tabular-nums opacity-50"
                        >
                          {item.number}
                        </span>
                        <span>{item.label}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        ) : null}

        <div className="mt-auto flex flex-col items-center gap-3 px-[22px] pt-8 text-center">
          <p
            className="max-w-full break-all text-[12.5px] text-ink-soft"
            data-testid="user-email"
          >
            {userEmail}
          </p>
          <StatusBadge label={roleLabel} tone="active" />
          {showCambiarPassword ? (
            <Link
              href={CAMBIAR_PASSWORD_PATH}
              onClick={() => setMenuOpen(false)}
              className="text-[13px] text-accent-deep"
            >
              {copy.nav.cambiarPassword}
            </Link>
          ) : null}
          {/* The other open tabs leave too. */}
          <form action={logoutAction} onSubmit={() => anunciarSalida("manual")}>
            <Button type="submit" variant="secondary" disabled={logoutPending}>
              {copy.auth.logout}
            </Button>
          </form>
          {logoutState && !logoutState.ok ? (
            <p role="alert" className="text-[12.5px] italic text-accent-deep">
              {logoutState.error}
            </p>
          ) : null}
        </div>
      </aside>

      {/* With the menu hidden, a gutter keeps the page clear of the button. */}
      <div className={menuOculto ? "nav:pl-[60px]" : "nav:pl-[234px]"}>
        <main>{children}</main>
      </div>
      <SesionInactividad cambioPendiente={cambioPendiente} />
    </div>
  );
}
