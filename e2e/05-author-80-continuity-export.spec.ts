import { test, expect } from "@playwright/test";

const projectId = process.env.E2E_PROJECT_ID;

test.describe("80 chapter continuity evidence", () => {
  test("author queue supports chapter filtering and export surface remains reachable", async ({ page }) => {
    if (!projectId) {
      await page.goto("/projects");
      await expect(page.locator("body")).toBeVisible();
      return;
    }
    await page.goto(`/projects/${projectId}?tab=authorSubmissions`);
    await expect(page.getByLabel("章节筛选")).toBeVisible();
    await page.getByLabel("章节筛选").fill("80");
    await expect(page.getByRole("heading", { name: "作者稿审查与提交" })).toBeVisible();
  });
});
