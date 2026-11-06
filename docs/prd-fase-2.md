# PRD Fase 2 v0.4 — Recibos de sueldo y firma electrónica

| Field | Value |
|---|---|
| Project | APP - TSM — Portal "Mi TSM" (Tecno San Martín) |
| Phase | Fase 2 |
| Status | Approved by Luciano 06/11/2026. Committed as `docs/prd-fase-2.md` by `TSM-F2-02` |
| Sources | TSM-DEV-F2-BRIEF v1.0, TSM-HANDOFF-F1-DEV v1.0, TSM-HANDOFF-F1-PM v1.0, Luciano's answers 06/11/2026 (Q1–Q14, P1, P2) |
| Date | 06/11/2026 |

Change log: v0.4 — approved; employee notification is a pending-receipts counter on the Mis Recibos menu item (no new notifications table); dependency security update added as the first piece. v0.3 — P1 closed (view before signing, download after); P2 closed (signed PDF replaces the unsigned file). No open items. v0.2 — decisions Q1–Q14 applied; two items left open for clarification (**[P1]** view before signing, **[P2]** keep original after signing). v0.1 — initial draft.

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

### 4.2 Carga de recibos (F2-04)
- RF-05. One screen "Carga de recibos". The Admin picks the period and sees one drop slot per active employee, all on the same screen, no navigation between employees.
- RF-06. Each slot shows the employee's name and state: sin recibo / cargado / firmado.
- RF-07. Server-side validation: PDF only, max 10 MB (Fase 1 documents pattern).
- RF-08. **DNI check.** On upload, the server extracts the PDF text and looks for the employee's DNI as stored in their legajo (7 or 8 digits), ignoring dots, spaces and hyphens. Outcomes:
  - Found: upload proceeds.
  - Not found: the Admin gets a message explaining that the employee's DNI was not found in the file, and chooses **Aceptar** (upload anyway) or **Rechazar** (discard the file).
  - Text cannot be read (for example a scanned PDF) or the employee has no DNI loaded: the Admin gets a message explaining that the DNI could not be verified and why, and chooses Aceptar or Rechazar.
- RF-09. **Override evidence.** Every Aceptar after a failed or impossible DNI check is recorded: Admin, date and time, receipt, and reason (no encontrado / no verificable / sin DNI cargado). Shown in the receipt history.
- RF-10. **Replacement.** If the employee already has a receipt in the period, the Admin gets an alert that the existing receipt will be replaced and confirms or cancels. On confirm, the previous file moves to the receipt history (not visible to the employee) and the new one becomes current.
- RF-11. **Replacing a signed receipt.** Allowed, with the same alert stating that the receipt is already signed and that the employee will have to sign again. The signed file and its signature record stay in the history. The new receipt starts as pendiente.
- RF-12. Uploads that fail after the file reaches storage leave no orphan file (Fase 1 lazy sweep pattern).

### 4.3 Mis Recibos (F2-05)
- RF-13. The employee sees their receipts from published periods, newest first, with state pendiente de firma / firmado.
- RF-14. Before signing, the employee can view the receipt but not download it. Download is enabled once signed. All file access through 5-minute signed URLs, never through a Server Action response (Vercel ~4.5 MB limit).
- RF-15. **Register signature.** The first time the employee signs, they draw their signature (mouse or touch, usable at 390 px) and confirm it.
- RF-16. **Redraw.** The employee can redraw their signature at any time. Receipts already signed do not change. Previous signature versions are kept as evidence, not deleted.
- RF-17. **Firmar recibo.** The button stamps the current registered signature at the bottom of the last page, with date and time (America/Argentina/Buenos_Aires) and the employee's name. Signature is in conformity only (no disconformidad option).
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
- Private bucket(s) for receipts and signatures. Storage policies scoped by employee. 5-minute signed URLs.
- All Server Action inputs `.strict()` at every level, refused before any I/O. Boundary test per new action.
- Admin-only code and copy (Carga, Estado, overrides, history) in Admin-only modules covered by the ESLint rule and bundle check.
- PDF text extraction and stamping run server-side only. Libraries reviewed in F2-07.

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
- Licencias, ausencias, comunicados (Fase 3).
- Granting employees their login.
- Production hardening, backups, retention, DB sizing (Fase 3).

## 9. Definition of Done

As in TSM-DEV-F2-BRIEF §9: CI green on every job; boundary test per new Server Action; RLS and storage isolation tests; es-AR copy centralized; no secrets; types regenerated after each migration; migrations applied through `TSM-F2-PUSH-NN` with Local = Remote before and after; clean Codex audit; visual matrix light/dark × 1280/390 with no horizontal scroll; phase close with full audit, Constitution bump and Fase 3 handoff notes.

