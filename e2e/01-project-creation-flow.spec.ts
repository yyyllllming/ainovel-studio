import { test, expect } from "@playwright/test";

test.describe("Project workspace shell", () => {
  test("project list is reachable with keyboard-visible controls", async ({ page }) => {
    await page.goto("/projects");
    await expect(page.locator("body")).toContainText(/项目|Project/u);
    await expect(page.locator("a,button").first()).toBeVisible();
  });
});
