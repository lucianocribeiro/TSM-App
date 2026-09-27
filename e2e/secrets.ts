import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";

// Temporary passwords the e2e tests generate must never reach an uploaded
// artifact (screenshots, report, traces) or a log.
//
// - registerSecret: remembers a generated value in this worker, and appends it
//   to SECRETS_FILE (outside every uploaded folder) for the artifact scan that
//   CI runs after the tests (e2e/scan-artifacts.mjs).
// - maskSecretsOnPage: replaces a shown password with a placeholder, in the
//   DOM only, before a screenshot.
// - assertNoSecretOnPage: fails a screenshot that would still show one. Images
//   cannot be searched for text afterwards, so this check runs before capture.
// Failures never print the value.

export const SECRETS_FILE = path.join(process.cwd(), ".e2e-secrets", "generated.txt");
export const MASK = "CONTRASEÑA-DE-PRUEBA";

const secrets = new Set<string>();

export function registerSecret(value: string): string {
  if (!value) throw new Error("registerSecret needs a non-empty value.");
  secrets.add(value);
  mkdirSync(path.dirname(SECRETS_FILE), { recursive: true });
  appendFileSync(SECRETS_FILE, `${value}\n`, "utf8");
  return value;
}

// The one-time password display and the temporary-password fields.
const SECRET_SELECTORS = ['[data-testid="password-una-vez"]', 'input[name="passwordTemporal"]'];

export async function maskSecretsOnPage(page: Page): Promise<void> {
  await page.evaluate(
    ({ selectors, mask }) => {
      for (const element of document.querySelectorAll<HTMLElement>(selectors.join(","))) {
        // Only the DOM changes: the React state (and what a form submits) keeps
        // the real value.
        if (element instanceof HTMLInputElement) element.value = mask;
        else element.textContent = mask;
      }
    },
    { selectors: SECRET_SELECTORS, mask: MASK },
  );
}

export async function assertNoSecretOnPage(page: Page): Promise<void> {
  const texts = await page.evaluate(() => [
    document.body.innerText,
    ...Array.from(document.querySelectorAll("input, textarea"), (field) => (field as HTMLInputElement).value),
  ]);
  const shown = [...secrets].some((secret) => texts.some((text) => text.includes(secret)));
  if (shown) {
    throw new Error("A generated password is visible on the page: mask it before taking a screenshot.");
  }
}

// True when the page shows exactly this value somewhere, without putting the
// value in any assertion message.
export async function pageShows(page: Page, value: string): Promise<boolean> {
  return page.evaluate((needle) => document.body.innerText.includes(needle), value);
}
