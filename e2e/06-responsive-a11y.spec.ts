import { test, expect } from "@playwright/test";

for (const viewport of [
  { width: 375, height: 812 },
  { width: 768, height: 900 },
  { width: 1279, height: 900 },
  { width: 1440, height: 900 },
]) {
  test(`application has no horizontal overflow at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/projects");
    await expect(page.locator("body")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(2);
  });
}
