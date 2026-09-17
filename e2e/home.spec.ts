import { expect, test } from "@playwright/test";
import { copy } from "../src/lib/copy/es-AR";

test("home shows the placeholder heading", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: copy.app.placeholder }),
  ).toBeVisible();
});
