"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useActionState, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Logo } from "@/components/ui/Logo";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { logout } from "@/lib/auth/actions";
import { copy } from "@/lib/copy/es-AR";
import { isActivePath, type NavItem } from "@/lib/nav/nav";
import type { Theme } from "@/lib/theme/theme";

type AppShellProps = {
  navItems: NavItem[];
  userEmail: string;
  roleLabel: string;
  initialTheme: Theme;
  children: ReactNode;
};

const SIDEBAR_ID = "app-sidebar";

export function AppShell({
  navItems,
  userEmail,
  roleLabel,
  initialTheme,
  children,
}: AppShellProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutState, logoutAction, logoutPending] = useActionState(logout, null);

  return (
    <div className="min-h-screen">
      {/* Top bar, below 900px only. */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-rail px-4 py-2 text-rail-ink nav:hidden">
        <Logo alt={copy.app.logoAlt} size={40} />
        <Button
          variant="secondary"
          aria-expanded={menuOpen}
          aria-controls={SIDEBAR_ID}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? copy.common.closeMenu : copy.common.openMenu}
        </Button>
      </div>

      {menuOpen ? (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-30 bg-ink/40 nav:hidden"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}

      <aside
        id={SIDEBAR_ID}
        className={cx(
          "fixed inset-y-0 left-0 z-40 w-[234px] flex-col overflow-y-auto border-r border-line bg-rail py-[26px] text-rail-ink",
          menuOpen ? "flex" : "hidden",
          "nav:flex",
        )}
      >
        <div className="px-[22px]">
          <Logo alt={copy.app.logoAlt} size={72} preload />
        </div>

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
                      "flex items-baseline gap-3 border-l-2 px-[22px] py-[11px] text-[14.5px] no-underline transition-colors hover:bg-accent-soft",
                      active
                        ? "border-accent text-accent-deep"
                        : "border-transparent text-rail-ink",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="text-[10px] tracking-[.14em] tabular-nums opacity-50"
                    >
                      {item.number}
                    </span>
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="mt-auto flex flex-col items-start gap-3 px-[22px] pt-8">
          <p
            className="max-w-full break-all text-[12.5px] text-ink-soft"
            data-testid="user-email"
          >
            {userEmail}
          </p>
          <StatusBadge label={roleLabel} tone="active" />
          <ThemeToggle
            initialTheme={initialTheme}
            toDarkLabel={copy.theme.toDark}
            toLightLabel={copy.theme.toLight}
          />
          <form action={logoutAction}>
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

      <div className="nav:pl-[234px]">
        <main>{children}</main>
      </div>
    </div>
  );
}
