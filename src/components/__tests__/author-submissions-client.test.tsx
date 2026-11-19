import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AuthorSubmissionsClient } from "@/components/author-submissions-client";
import { renderWithProviders } from "@/test/test-utils";

function ok(data: unknown) {
  return Response.json({ data });
}

afterEach(() => vi.unstubAllGlobals());

describe("AuthorSubmissionsClient", () => {
  it("requires preview confirmation before importing a pasted chapter", async () => {
    let importCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/author-submissions")) return ok({ submissions: [] });
      if (url.endsWith("/preview")) return ok({
        previewId: "preview_1",
        chapterCount: 1,
        chapters: [{ chapterNo: 1, title: "第一章", characterCount: 12, contentHash: "a".repeat(64) }],
      });
      if (url.endsWith("/import")) {
        importCalls += 1;
        return ok({ results: [] });
      }
      throw new Error(url);
    }));
    renderWithProviders(<AuthorSubmissionsClient projectId="project-1" />);
    fireEvent.change(screen.getByLabelText("章节标题"), { target: { value: "第一章" } });
    fireEvent.change(screen.getByLabelText("完整正文"), { target: { value: "这是一段完整正文。" } });
    fireEvent.click(screen.getByRole("button", { name: "生成导入预览" }));
    expect(await screen.findByRole("heading", { name: "确认 1 章边界" })).toBeInTheDocument();
    expect(importCalls).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "确认导入" }));
    await waitFor(() => expect(importCalls).toBe(1));
  });

  it("renders and filters an 80-row author queue with hashes and statuses", async () => {
    const submissions = Array.from({ length: 80 }, (_, index) => ({
      id: `submission-${index + 1}`,
      chapterNo: index + 1,
      title: `第 ${index + 1} 章`,
      source: "codex",
      status: index === 79 ? "approved" : "draft",
      contentHash: String(index).padStart(64, "0"),
      parentSubmissionId: null,
      committedVersionId: null,
    }));
    vi.stubGlobal("fetch", vi.fn(async () => ok({ submissions })));
    renderWithProviders(<AuthorSubmissionsClient projectId="project-1" />);
    const queue = await screen.findByRole("list", { name: "作者稿审查队列" });
    expect(queue).toHaveAttribute("data-virtual-count", "80");
    expect(screen.getAllByRole("listitem").length).toBeLessThan(80);
    fireEvent.change(screen.getByLabelText("状态筛选"), { target: { value: "approved" } });
    expect(await screen.findByText("第 80 章", { selector: "h3" })).toBeInTheDocument();
    expect(screen.getAllByText("已通过").length).toBeGreaterThan(0);
    expect(screen.queryByText("第 1 章", { selector: "h3" })).not.toBeInTheDocument();
    expect(screen.getByText(submissions[79]!.contentHash.slice(0, 16))).toBeInTheDocument();
  });

  it("requires a reason before manually approving a needs-revision submission", async () => {
    const submission = {
      id: "submission-needs-revision",
      chapterNo: 25,
      title: "错站",
      source: "codex",
      status: "needs_revision",
      contentHash: "b".repeat(64),
      parentSubmissionId: null,
      committedVersionId: null,
    };
    let approveBody: unknown = null;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/author-submissions")) return ok({ submissions: [submission] });
      if (url.endsWith(`/author-submissions/${submission.id}/approve`)) {
        approveBody = JSON.parse(String(init?.body ?? "{}"));
        return ok({ submission: { ...submission, status: "committed" } });
      }
      throw new Error(url);
    }));

    renderWithProviders(<AuthorSubmissionsClient projectId="project-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "有理由人工批准" }));
    expect(screen.getByRole("heading", { name: "人工覆盖审查" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("覆盖原因"), { target: { value: "主作者确认审查窗口越界，当前稿已补足后果。" } });
    fireEvent.click(screen.getByRole("button", { name: "确认人工批准" }));

    await waitFor(() => expect(approveBody).toEqual({
      humanOverride: true,
      overrideReason: "主作者确认审查窗口越界，当前稿已补足后果。",
    }));
  });

  it("keeps stale reviews visible on small screens and dialogs keyboard-accessible", async () => {
    const [chapterSource, dialogSource] = await Promise.all([
      readFile(resolve(process.cwd(), "src/components/chapter-workshop-client.tsx"), "utf8"),
      readFile(resolve(process.cwd(), "src/components/confirm-dialog.tsx"), "utf8"),
    ]);
    expect(chapterSource).toContain("已失效审稿历史");
    expect(chapterSource).not.toContain('className="hidden xl:block w-80');
    expect(dialogSource).toContain('event.key === "Escape"');
    expect(dialogSource).toContain('event.key === "Tab"');
    expect(dialogSource).toContain("previousFocusRef.current?.focus()");
  });
});
