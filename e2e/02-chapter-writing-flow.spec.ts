import { test, expect } from "@playwright/test";

test.describe("Project navigation", () => {
  test("root navigation reaches a rendered application page", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("body")).not.toBeEmpty();
    await expect(page).toHaveURL(/\//u);
  });
});
