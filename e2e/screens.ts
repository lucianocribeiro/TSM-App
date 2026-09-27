import { expect, type Page } from "@playwright/test";
import { SCREENSHOT_DIR } from "./helpers";
import { assertNoSecretOnPage } from "./secrets";

// Light and dark screenshots of the current page state. The theme is switched
// in place, as the theme toggle does, so page state (an open dialog, a form)
// survives for the dark capture. Transitions are turned off so nothing is
// captured mid-fade, and a registered password on the page fails the capture.
export async function screenshotBoth(page: Page, name: string) {
  await assertNoSecretOnPage(page);
  await page.addStyleTag({ content: "*, *::before, *::after, *::backdrop { transition: none !important; }" });
  const html = page.locator("html");
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await expect(html).toHaveAttribute("data-theme", "light");
  await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}-light.png`, fullPage: true });
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}-dark.png`, fullPage: true });
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
}
