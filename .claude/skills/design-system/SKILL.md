---
name: design-system
description: Use for any UI work in Mi TSM: tokens, typography, layout, components, light and dark modes.
---
# Design system

## Source
The approved Claude Design prototype "Gestión de Empleados" defines style and structure only. Fields and scope come from the PRD.

## Rules
1. No hex colors outside `src/app/globals.css`. Components use the Tailwind utilities mapped to tokens (`bg-surface`, `text-ink-soft`, `border-line`, `text-accent-deep`, `bg-accent-soft`, ...).
2. Every screen is checked in light and dark mode.
3. Reuse components from `src/components/ui/` before creating new ones.
4. New components go in `src/components/ui/` and are added to the inventory below.
5. Theme is selected by `data-theme="light" | "dark"` on `<html>`, set on the server from the `tsm-theme` cookie and switched by `ThemeToggle`.
6. No UI text in components; text comes from `src/lib/copy/` via props (`es-ar-copy` skill).

## Fonts
Loaded with `next/font/google` in the root layout:
- Headings: Cormorant Garamond 400, 600 → `--font-heading` (fallback `system-ui, sans-serif`).
- Body: Lora 400, 500, 600, italic 400 → `--font-body` (fallback `system-ui, sans-serif`).

## Tokens (`src/app/globals.css`)
```css
:root {
  --accent: #fc6432;
  --accent-100: #fff0ea; --accent-200: #ffd9c9; --accent-300: #ffb69a;
  --accent-400: #fd8557; --accent-500: #fc6432; --accent-600: #e04d1c;
  --accent-700: #c9410f; --accent-800: #98300b; --accent-900: #5c1d06;

  --space-1: 4.6px; --space-2: 9.2px; --space-3: 13.8px;
  --space-4: 18.4px; --space-6: 27.6px; --space-8: 36.8px;
  --radius-sm: 2px; --radius-md: 4px; --radius-lg: 7px;
}
:root, :root[data-theme="light"] {
  --bg: #f3f2f2; --surface: #fbfafa; --ink: #00072e;
  --line: rgba(0,7,46,.16); --line-soft: rgba(0,7,46,.09);
  --ink-soft: #5f6479;
  --rail: #fbfafa; --rail-ink: #00072e;
  --accent-deep: var(--accent-700); --accent-soft: rgba(252,100,50,.10);
  --shadow: 0 1px 2px rgba(45,43,43,.14);
}
:root[data-theme="dark"] {
  --bg: #00072e; --surface: #040d38; --ink: #f3f2f2;
  --line: rgba(243,242,242,.20); --line-soft: rgba(243,242,242,.10);
  --ink-soft: #9aa2c0;
  --rail: #000418; --rail-ink: #f3f2f2;
  --accent-deep: var(--accent-300); --accent-soft: rgba(252,100,50,.16);
  --shadow: 0 1px 2px rgba(0,0,0,.5);
}
body { background: var(--bg); color: var(--ink); font-family: var(--font-body); font-size: 15px; line-height: 1.55; -webkit-font-smoothing: antialiased; }
h1,h2,h3,h4 { font-family: var(--font-heading); }
a { color: var(--accent-deep); }
*:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
::selection { background: var(--accent-soft); }
```
Tailwind v4 `@theme inline` maps them to utilities: colors `bg`, `surface`, `ink`, `ink-soft`, `line`, `line-soft`, `rail`, `rail-ink`, `accent`, `accent-deep`, `accent-soft`, `accent-100` to `accent-900`; fonts `font-heading`, `font-body`; radii `rounded-sm`, `rounded-md`, `rounded-lg`; shadow `shadow-panel`. Breakpoint `nav` = 900px (sidebar collapses below it).

## Style rules
- **Layout:** fixed left sidebar 234px wide (`--rail` background, `--rail-ink` text, right border `--line`, vertical padding 26px, horizontal 22px). Main area: header with bottom border `--line`, padding `26px 34px 16px`; content padding `26px 34px 40px`. Below 900px the sidebar collapses behind a menu button in a top bar, with the same items and footer.
- **Page header:** kicker above title. Kicker: 10.5px, uppercase, letter-spacing .20em, `--ink-soft`. Title: heading font, weight 400, 38px, line-height 1.08, margin-top 6px.
- **Sidebar nav item:** 14.5px, padding `11px 22px`, left border 2px (transparent; `--accent` when active), a small number before the label (10px, letter-spacing .14em, opacity .5, tabular numbers: "01", "02"…). Hover background `--accent-soft`. Active label color `--accent-deep`.
- **Sidebar top:** only the TSM logo (`public/logotsm.png`). No tagline or subtitle.
- **Panels:** border 1px `--line`, radius `--radius-md`, background `--surface`, padding 22px.
- **Buttons:** primary = transparent background, 1px `--accent` border, `--accent-deep` text, 13px, padding `8px 16px`, radius `--radius-md`, hover background `--accent-soft`. Secondary = 1px `--line` border, `--ink` text, hover border `--accent` and text `--accent-deep`. Disabled opacity .45.
- **Inputs:** transparent background, 1px `--line` border, radius `--radius-md`, padding `9px 12px`, 14px; focus border `--accent`. Labels: 10.5px uppercase, letter-spacing .16em, `--ink-soft`.
- **Status badge:** inline-flex, gap 7px, padding `3px 9px`, 1px `--line` border, radius `--radius-md`, 11.5px, with a 6px dot (`--accent` for active; `--ink-soft` for secondary states).
- Numbers use `font-variant-numeric: tabular-nums`. Secondary text uses `--ink-soft`; helper text may be italic 12.5px.

### Specs for later components (not built yet)
- **KPI strip:** grid `repeat(auto-fit, minmax(148px,1fr))`, one bordered `--surface` container, cells padding `18px 20px` separated by `--line-soft`; label 10.5px uppercase letter-spacing .18em `--ink-soft`; value heading font 36px tabular.
- **Table:** bordered `--surface` container with horizontal scroll; header row 10.5px uppercase letter-spacing .16em `--ink-soft`, padding `11px 18px`, bottom border `--line`; rows padding `14px 18px`, bottom border `--line-soft`, 14px, hover `--accent-soft`, pointer when clickable; secondary columns `--ink-soft`.
- **Label/value grid:** `repeat(auto-fit, minmax(150px,1fr))`, gap `18px 26px`; label as input label style; value 15px.
- **Segmented filter:** bordered group, buttons padding `9px 14px`, 12.5px, separated by `--line-soft`, hover `--accent-soft`, active `--accent-deep` text.

## Component inventory (`src/components/ui/`)
| Component | Purpose | Key props |
|---|---|---|
| `Button` | Primary and secondary actions | `variant: "primary" \| "secondary"`, native button props |
| `Input` | Text input | native input props |
| `Field` | Label + `Input` + error message | `label`, `error?`, input props |
| `Panel` | Bordered surface container | native div props |
| `PageHeader` | Kicker, title, optional actions | `kicker`, `title`, `actions?` |
| `StatusBadge` | Status with dot | `label`, `tone: "active" \| "secondary"` |
| `ThemeToggle` | Switches light/dark and persists the `tsm-theme` cookie | `initialTheme`, `toDarkLabel`, `toLightLabel` |
| `Logo` | TSM logo via `next/image` | `alt`, `size?`, `preload?` |

Helper: `cx` joins class names.
