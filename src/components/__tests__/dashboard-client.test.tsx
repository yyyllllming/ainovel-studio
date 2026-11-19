import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { DashboardClient } from "@/components/dashboard-client";
import { renderWithProviders } from "@/test/test-utils";
import { routerPushMock } from "@/test/setup";

const apiGetMock = vi.fn();
const apiPostMock = vi.fn();

vi.mock("@/lib/api", () => ({
  apiGet: (...args: unknown[]) => apiGetMock(...args),
  apiPost: (...args: unknown[]) => apiPostMock(...args),
}));

describe("DashboardClient", () => {
  beforeEach(() => {
    apiGetMock.mockImplementation(async (path: string) => {
      if (path === "/api/settings/llm-profiles") {
        return { profiles: [] };
      }
      if (path === "/api/projects") {
        return { projects: [] };
      }
      return {};
    });
    apiPostMock.mockReset();
  });

  it("renders the provided project list", () => {
    renderWithProviders(
      <DashboardClient
        initialProfiles={{
          profiles: [
            {
              id: "profile-1",
              name: "Primary Relay",
              defaultModel: "writer-1",
              baseUrl: "https://relay.example.com/v1",
            },
          ],
        }}
        initialProjects={{
          projects: [
            {
              id: "project-1",
              title: "雾港夜巡",
              genre: "悬疑",
              style: "default",
              targetChapters: 12,
              premise: "夜禁失效后，港城开始出现会说话的雾。",
              seriesMode: "standalone",
              seriesTitle: null,
              seriesIndex: null,
              storyLength: "long",
              narrativePerson: "third",
              chapterPlanningMode: "fixed",
              paceProfile: "medium",
              completionCriteria: "主线闭环",
              chapterBudgetMin: 10,
              chapterBudgetTarget: 12,
              chapterBudgetMax: 14,
              hardChapterCap: 12,
              hasVolumes: false,
              plannedVolumes: null,
              status: "ideation",
              updatedAt: "2026-04-02T00:00:00.000Z",
            },
            {
              id: "project-2",
              title: "纸桥回声",
              genre: "奇幻",
              style: "default",
              targetChapters: 8,
              premise: "一座纸桥只在暴雨夜通往旧王城。",
              seriesMode: "standalone",
              seriesTitle: null,
              seriesIndex: null,
              storyLength: "medium",
              narrativePerson: "first",
              chapterPlanningMode: "fixed",
              paceProfile: "fast",
              completionCriteria: "主线闭环",
              chapterBudgetMin: 6,
              chapterBudgetTarget: 8,
              chapterBudgetMax: 8,
              hardChapterCap: 8,
              hasVolumes: false,
              plannedVolumes: null,
              status: "foundation_ready",
              updatedAt: "2026-04-01T00:00:00.000Z",
            },
          ],
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "项目总览" })).toBeInTheDocument();
    expect(screen.getByText("项目 2")).toBeInTheDocument();
    expect(screen.getByText("雾港夜巡")).toBeInTheDocument();
    expect(screen.getByText("纸桥回声")).toBeInTheDocument();
  });

  it("refetches the project list on mount so stale initial data gets replaced", async () => {
    // 模拟「项目详情页删除项目后跳回总览」：服务端列表已经不含该项目，
    // 查询不能因 refetchOnMount:false 一直停留在过期的 initialData。
    renderWithProviders(
      <DashboardClient
        initialProfiles={{ profiles: [] }}
        initialProjects={{
          projects: [
            {
              id: "project-trashed",
              title: "已删项目",
              genre: "悬疑",
              style: "default",
              targetChapters: 12,
              premise: "一个已经被移入回收站的项目。",
              seriesMode: "standalone",
              seriesTitle: null,
              seriesIndex: null,
              storyLength: "long",
              narrativePerson: "third",
              chapterPlanningMode: "fixed",
              paceProfile: "medium",
              completionCriteria: "主线闭环",
              chapterBudgetMin: 10,
              chapterBudgetTarget: 12,
              chapterBudgetMax: 14,
              hardChapterCap: 12,
              hasVolumes: false,
              plannedVolumes: null,
              status: "ideation",
              updatedAt: "2026-04-02T00:00:00.000Z",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("已删项目")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByText("已删项目")).not.toBeInTheDocument();
    });
    expect(apiGetMock).toHaveBeenCalledWith("/api/projects");
  });

  it("routes newly created projects into the foundation workshop", async () => {
    apiPostMock.mockResolvedValueOnce({
      project: {
        id: "project-new",
      },
    });

    renderWithProviders(
      <DashboardClient
        initialProfiles={{
          profiles: [
            {
              id: "profile-1",
              name: "Primary Relay",
              defaultModel: "writer-1",
              baseUrl: "https://relay.example.com/v1",
            },
          ],
        }}
        initialProjects={{ projects: [] }}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "新建项目" })[0]!);
    fireEvent.change(screen.getByPlaceholderText("给你的故事起个名字"), {
      target: { value: "新项目" },
    });
    fireEvent.change(screen.getByPlaceholderText("可选预设，也可以直接自己写"), {
      target: { value: "玄幻修仙" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建项目" }));

    await waitFor(() => {
      expect(routerPushMock).toHaveBeenCalledWith("/projects/project-new?tab=chat");
    });
  });
});
