import { test, expect } from "@playwright/test";

test.describe("Responsive application shell", () => {
  test("project list remains usable at tablet width", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    await page.goto("/projects");
    await expect(page.locator("body")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(2);
  });
});
