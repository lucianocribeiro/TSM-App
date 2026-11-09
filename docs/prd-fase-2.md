# PRD Fase 2 v0.8 — Recibos de sueldo y firma electrónica

| Field | Value |
|---|---|
| Project | APP - TSM — Portal "Mi TSM" (Tecno San Martín) |
| Phase | Fase 2 |
| Status | Approved by Luciano 06/11/2026. Committed as `docs/prd-fase-2.md` by `TSM-F2-02` |
| Sources | TSM-DEV-F2-BRIEF v1.0, TSM-HANDOFF-F1-DEV v1.0, TSM-HANDOFF-F1-PM v1.0, Luciano's answers 06/11/2026 (Q1–Q14, P1, P2) |
| Date | 06/11/2026 |

Change log: v0.8 — Mis Recibos built (TSM-F2-05): "Ver" opens the PDF in a new tab (no download offered before signing); signing time is server time checked by the database within 2 minutes; the signing statement; the stamp name comes from the legajo; a minimum drawing for a signature. v0.7 — Carga de recibos built (TSM-F2-04): rows are active Empleado accounts only; replaced files stay in storage; no period deletion; the receipts screen's functions run for at most 30 seconds. v0.6 — libraries chosen (TSM-F2-07): `unpdf` for the DNI text check and `@cantoo/pdf-lib` for the signature stamp, server-only; signature drawing and drag-and-drop use no library. v0.5 — storage defined (TSM-F2-03): two private buckets, `recibos` (PDF, 10 MB) and `firmas` (PNG, 1 MB), owner-first path layouts enforced by the database. v0.4 — approved; employee notification is a pending-receipts counter on the Mis Recibos menu item (no new notifications table); dependency security update added as the first piece. v0.3 — P1 closed (view before signing, download after); P2 closed (signed PDF replaces the unsigned file). No open items. v0.2 — decisions Q1–Q14 applied; two items left open for clarification (**[P1]** view before signing, **[P2]** keep original after signing). v0.1 — initial draft.

---

## 1. Objective

Admins upload salary receipts by period. Each employee views, downloads and electronically signs only their own receipt. Admins track signed versus pending. Built on the Fase 1 auth, role and data-isolation foundation.

## 2. Roles

- **Admin:** creates, publishes, closes and re-opens periods; uploads and replaces receipts; sees status for every employee; sees receipts and employees' registered signatures.
- **Empleado:** sees only their own receipts and their own signature. Never another employee's receipt, signature or file. Enforced by RLS and storage policies, not only in the app.

## 3. Concepts

- **Período:** a month (MM/AAAA). States: borrador → publicado → cerrado. A closed period can be re-opened by an Admin (logged).
- **Recibo:** one PDF per employee per period, in private storage.
- **Firma registrada:** the employee's drawn signature, captured once, stored per employee, versioned. Visible to the employee and to Admins.
- **Firma de recibo:** stamping the current registered signature onto the receipt with date and time.
- **Recibo firmado:** the stamped PDF. It replaces the unsigned file in storage; the unsigned file is not kept.

## 4. Functional requirements

### 4.1 Períodos
- RF-01. The Admin creates a period by choosing month and year. One period per month. New periods start in **borrador**.
- RF-02. **Publicar.** Employees see nothing of a period until the Admin publishes it. Receipts uploaded to an already published period become visible on upload. Visibility drives the employee's pending counter (RF-23) and, later, one email per newly visible receipt (RF-24).
- RF-03. **Cerrar.** A closed period accepts no uploads or replacements. Employees can still view and sign.
- RF-04. **Reabrir.** An Admin can re-open a closed period. Who and when is logged and shown in the period history.
- There is no period deletion. A period created by mistake stays as an empty borrador, which no employee sees.

### 4.2 Carga de recibos (F2-04)
- RF-05. One screen "Carga de recibos". The Admin picks the period and sees one drop slot per employee, all on the same screen, no navigation between employees. Rows are the accounts with role Empleado and an active account only: Admins never get a row, and a deactivated account gets no row and cannot receive a receipt (reactivate it first).
- RF-06. Each slot shows the employee's name and state: sin recibo / cargado / firmado.
- RF-07. Server-side validation: PDF only, max 10 MB (Fase 1 documents pattern).
- RF-08. **DNI check.** On upload, the server extracts the PDF text and looks for the employee's DNI as stored in their legajo (7 or 8 digits), ignoring dots, spaces and hyphens. Outcomes:
  - Found: upload proceeds.
  - Not found: the Admin gets a message explaining that the employee's DNI was not found in the file, and chooses **Aceptar** (upload anyway) or **Rechazar** (discard the file).
  - Text cannot be read (for example a scanned PDF) or the employee has no DNI loaded: the Admin gets a message explaining that the DNI could not be verified and why, and chooses Aceptar or Rechazar.
- RF-09. **Override evidence.** Every Aceptar after a failed or impossible DNI check is recorded: Admin, date and time, receipt, and reason (no encontrado / no verificable / sin DNI cargado). Shown in the receipt history.
- RF-10. **Replacement.** If the employee already has a receipt in the period, the Admin gets an alert that the existing receipt will be replaced and confirms or cancels. On confirm, the previous file moves to the receipt history (not visible to the employee) and the new one becomes current. Replaced files stay in storage: the history references them.
- RF-11. **Replacing a signed receipt.** Allowed, with the same alert stating that the receipt is already signed and that the employee will have to sign again. The signed file and its signature record stay in the history. The new receipt starts as pendiente.
- RF-12. Uploads that fail after the file reaches storage leave no orphan file (Fase 1 lazy sweep pattern).

### 4.3 Mis Recibos (F2-05)
- RF-13. The employee sees their receipts from published periods, newest first, with state pendiente de firma / firmado.
- RF-14. Before signing, the employee can view the receipt but not download it. Download is enabled once signed. All file access through 5-minute signed URLs, never through a Server Action response (Vercel ~4.5 MB limit).
  - "Ver" opens the PDF in a new browser tab through a 5-minute signed URL served inline (works on phones; no embedded viewer). Before signing the app offers no download button. A browser can still save a file it displays: the rule is about what the app offers, not a technical lock. After signing, "Descargar" serves `Recibo-MM-AAAA.pdf`.
- RF-15. **Register signature.** The first time the employee signs, they draw their signature (mouse or touch, usable at 390 px) and confirm it.
  - An empty signature is refused: "Guardar firma" stays disabled until the drawing has at least 150 px of stroke and 400 px of ink (CSS pixels); "Borrar" clears it. The server also checks the image: PNG, at most 1 MB, between 100 × 40 and 2000 × 1000 px.
- RF-16. **Redraw.** The employee can redraw their signature at any time. Receipts already signed do not change. Previous signature versions are kept as evidence, not deleted.
- RF-17. **Firmar recibo.** The button stamps the current registered signature at the bottom of the last page, with date and time (America/Argentina/Buenos_Aires) and the employee's name. Signature is in conformity only (no disconformidad option).
  - The confirmation shows the statement "Al firmar, confirmás que recibiste este recibo de sueldo." (Luciano may adjust it) and the current signature.
  - The stamp line: "Firmado electrónicamente por {nombre} el {dd/mm/aaaa} a las {HH:mm} (hora de Argentina)".
  - The name is the legajo's names and surname (Datos personales); when both are empty, a fixed text ("la persona titular de la cuenta (sin nombre en el legajo)"); never an id or an email.
  - The signing time is taken once on the server, stamped on the PDF and passed to the database, which accepts it only within the last 2 minutes of its own clock (5 seconds of clock skew allowed ahead). The PDF and the evidence always show the same time.
- RF-18. A signed receipt cannot be signed again.

### 4.4 Estado de firmas (F2-06)
- RF-19. Admin view per period: each employee with state sin recibo / pendiente / firmado, signature date and time, filters by state, counts per state.
- RF-20. The Admin can view and download each current receipt and the history of replaced files.
- RF-21. No raw id in any status or history view: name, else email, else "Usuario no disponible".

### 4.5 KPI "Recibos sin firmar" (Legajos)
- RF-22. Card on the Legajos list: number of employees with at least one unsigned receipt in a published period, across all periods. Only KPI card on that screen.

### 4.6 Notificaciones
- RF-23. In-app notice: the "Mis Recibos" menu item shows a counter with the number of the employee's receipts that are visible and unsigned. It is derived from the receipts data; there is no notifications table. The existing Admin bell (Aprobaciones) is not changed.
- RF-24. Email from `no-reply@` on TSM's domain, through a transactional provider owned by TSM. Provider credentials and sender address are environment configuration only. Built last; nothing else depends on it. Domain, DNS access and provider: pending from Luciano.

## 5. Signature evidence

Recorded per signed receipt, readable by Admins and by the signing employee only:
- Identity of the signer (stored as user id, displayed as name), with role and ownership checked at signing time.
- Date and time of signature (server time, stored in UTC, shown in Argentina time).
- Which registered signature version was used.

Written only through a SECURITY DEFINER function with `search_path = ''`, executable only by the employee for their own receipt. Not editable or deletable afterwards through the app. No third-party certificate (TSM's lawyer confirmed, per brief). No file hash and no IP recorded.

## 6. Data and security

- New tables (names final in TSM-F2-02): periods (with state history), receipts (per employee per period, current file path, state), receipt history (replaced files and their signature records), signature records, registered signatures (versioned), upload overrides.
- RLS on every new table, with an isolation test for each (employee A cannot read employee B; employees cannot read draft periods).
- Private buckets (TSM-F2-03):
  - `recibos`: receipt PDFs, PDF only, max 10 MB. Path `{empleado_id}/{periodo_id}/{uuid}.pdf`; the stamped PDF of F2-05 gets a new uuid in the same folder.
  - `firmas`: registered signature images, PNG only, max 1 MB. Path `{empleado_id}/{version}-{uuid}.png`.
  - The first folder is always the owner's profile id. The database checks every stored path against its row's owner (and period, for receipts, history and overrides).
  - Storage policies: SELECT only, active accounts only. An Admin reads every object; an Empleado reads an object in their own folder only when a row they can see references it (so never a draft period's file, a replaced file or an unreferenced object). No write policy: uploads use server-created signed upload URLs, removals run server-side. 5-minute signed URLs for downloads.
- All Server Action inputs `.strict()` at every level, refused before any I/O. Boundary test per new action.
- Admin-only code and copy (Carga, Estado, overrides, history) in Admin-only modules covered by the ESLint rule and bundle check.
- PDF text extraction and stamping run server-side only. Libraries reviewed in F2-07.
- The receipts screen and its Server Actions run for at most 30 seconds (route segment `maxDuration`), so a PDF that overruns the 5-second DNI text limit cannot hold the function longer.

### Librerías (TSM-F2-07)

| Need | Library | Version | License |
|---|---|---|---|
| PDF text extraction for the DNI check (RF-08) | `unpdf` | 2.1.0 | MIT |
| Stamping the signature on the last page (RF-17) | `@cantoo/pdf-lib` | 2.11.1 | MIT |

- Both are imported only by the server-only wrappers `src/lib/recibos/pdf-texto.ts` and `src/lib/recibos/pdf-firma.ts` (and their tests); an ESLint rule refuses the import anywhere else.
- DNI check limits: 20 pages and 5 seconds per file; beyond either, the DNI is "no verificable".
- Signature drawing (RF-15) uses a `<canvas>` with Pointer Events and `canvas.toBlob("image/png")`; the upload slots (RF-05) use native drag-and-drop with an `<input type="file">` fallback. No library for either.

## 7. Pieces and sequence

| Order | Plan ID | Piece |
|---|---|---|
| 0 | — | TSM-F2-SEC-01: security update of existing dependencies (npm audit: 1 critical, 3 high at preflight) |
| 1 | F2-02 | Schema + RLS (+ PRD commit, Constitution v0.10) |
| 2 | F2-03 | Storage bucket(s), storage policies, signed URLs |
| 3 | F2-07 | Dependency review for PDF/upload/signature libraries, before code uses them |
| 4 | F2-04 | Carga de recibos with DNI check, replacement, publish/close/re-open |
| 5 | F2-05 | Mis Recibos, signature registration and signing |
| 6 | F2-06 | Estado de firmas + KPI card on Legajos |
| 7 | — | Email notification (when TSM's domain and provider are available) |
| 8 | F2-08 | E2E and isolation suite |
| 9 | F2-09 | Phase close |

## 8. Out of scope

- Generating receipts from the liquidación Excel (Fase 4).
- Deleting a receipt period.
- Licencias, ausencias, comunicados (Fase 3).
- Granting employees their login.
- Production hardening, backups, retention, DB sizing (Fase 3).

## 9. Definition of Done

As in TSM-DEV-F2-BRIEF §9: CI green on every job; boundary test per new Server Action; RLS and storage isolation tests; es-AR copy centralized; no secrets; types regenerated after each migration; migrations applied through `TSM-F2-PUSH-NN` with Local = Remote before and after; clean Codex audit; visual matrix light/dark × 1280/390 with no horizontal scroll; phase close with full audit, Constitution bump and Fase 3 handoff notes.

