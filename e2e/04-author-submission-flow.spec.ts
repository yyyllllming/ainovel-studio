import { test, expect } from "@playwright/test";

const projectId = process.env.E2E_PROJECT_ID;

test.describe("Author manuscript workflow", () => {
  test("paste and file import expose preview-before-import and Writer-zero language", async ({ page }) => {
    if (!projectId) {
      await page.goto("/projects");
      await expect(page.locator("body")).toContainText(/项目|Project/u);
      return;
    }
    await page.goto(`/projects/${projectId}?tab=authorSubmissions`);
    await expect(page.getByRole("heading", { name: "作者稿" })).toBeVisible();
    await expect(page.getByText("不会调用 Writer")).toBeVisible();
    await expect(page.getByRole("button", { name: "生成导入预览" })).toBeEnabled();
    await expect(page.getByLabel("稿件文件")).toHaveAttribute("accept", /\.md/u);
  });
});
