import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { ProjectDetailClient } from "@/components/project-detail-client";
import { getProjectWorkspaceTabStorageKey } from "@/components/project/use-project-detail-controller";
import { renderWithProviders } from "@/test/test-utils";
import {
  routerReplaceMock,
  setPathnameMock,
  setSearchParamsMock,
} from "@/test/setup";
import type { ProjectRunProgress } from "@/lib/types/chapter";
import type { ProjectDetail } from "@/lib/types/project";

const initialSnapshot: ProjectDetail = {
  project: {
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
    status: "foundation_locked",
    updatedAt: "2026-04-02T00:00:00.000Z",
  },
  storyContract: {
    volumes: [
      {
        volumeNo: 1,
        label: "第一卷",
        goal: "查出港城雾灾源头",
        status: "active",
        chapterStart: 1,
        chapterEnd: 12,
        chapterBudgetMin: 10,
        chapterBudgetTarget: 12,
        chapterBudgetMax: 14,
      },
    ],
    currentVolume: 1,
    globalArc: "找出雾灾背后的真相",
    endingPromise: "揭开雾灾真相并让主角付出代价",
    completionChecks: ["主线闭环"],
    forecast: {
      min: 10,
      target: 12,
      max: 14,
      finalRunReady: false,
      completionProgress: 0.35,
      nextMilestone: "拿到第一条关键证据",
    },
    recentPlan: ["继续追查纸灯会"],
    updatedAt: "2026-04-02T00:00:00.000Z",
  },
  steeringNotes: [],
  resolvedReviewPolicy: {
    cadenceChapters: 99,
    deepReviewStartChapter: 99,
    perChapterCheckMode: "minimal",
    forceTriggers: [],
    manualCheckpointChapters: [],
  },
  assignments: [],
  foundation: {
    premise: "夜禁失效后，港城开始出现会说话的雾。",
    characters: [],
    worldview: [],
  },
  foundationLocked: true,
  runState: {
    stage: "idle",
    desiredState: "idle",
    currentChapter: 1,
  },
  sourceIdea: null,
  blueprints: [],
  writtenChapters: [1, 2],
  recentReviews: [],
  conflicts: [],
  reviewStates: [],
  invalidatedHistory: [],
  runStatisticsSummary: {
    windowSize: 20,
    sampleCount: 0,
    repairRate: 0,
    fallbackRate: 0,
    hardConflictRate: 0,
    medianVerificationScore: null,
    recommendation: "data_insufficient",
  },
  novelExport: {
    exists: false,
    status: "pending",
  },
  logs: [],
};

const newProjectSnapshot: ProjectDetail = {
  ...initialSnapshot,
  project: {
    ...initialSnapshot.project,
    status: "ideation",
  },
  foundationLocked: false,
  writtenChapters: [],
};

const driftingSnapshot: ProjectDetail = {
  ...initialSnapshot,
  coreDrift: true,
  blockingReason: "检测到设定工坊中的核心事实尚未整理为正式设定，请先整理正式设定后再开始自动写作。",
};

const initialProgress: ProjectRunProgress = {
  running: false,
  stage: "idle",
  currentChapter: 3,
  totalChapters: 12,
  retryCount: 0,
  confidence: 0,
  desiredState: "idle",
  logs: [],
};

describe("ProjectDetailClient", () => {
  it("renders the outline workspace without crashing", () => {
    renderWithProviders(
      <ProjectDetailClient
        projectId="project-1"
        initialSnapshot={initialSnapshot}
        initialProgress={initialProgress}
      />,
    );

    expect(screen.getByRole("heading", { name: "雾港夜巡" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "章节结构" })).toBeInTheDocument();
    expect(screen.getAllByText("第 3 章")).toHaveLength(2);
    expect(screen.getByText("当前推进位置")).toBeInTheDocument();
    expect(screen.getByText("样本不足，继续观察")).toBeInTheDocument();
  });

  it("restores the workspace tab from the URL and syncs tab switches into history", () => {
    setPathnameMock("/projects/project-1");
    setSearchParamsMock("tab=chat");

    renderWithProviders(
      <ProjectDetailClient
        projectId="project-1"
        initialSnapshot={initialSnapshot}
        initialProgress={initialProgress}
      />,
    );

    expect(screen.getByRole("heading", { name: "设定工坊" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "模型分配" }));

    expect(routerReplaceMock).toHaveBeenCalledWith("/projects/project-1?tab=models", { scroll: false });
    expect(screen.getAllByRole("heading", { name: "模型分配" })).toHaveLength(2);
  });

  it("defaults brand-new projects to the foundation workshop and syncs the URL", () => {
    setPathnameMock("/projects/project-1");
    setSearchParamsMock("");

    renderWithProviders(
      <ProjectDetailClient
        projectId="project-1"
        initialSnapshot={newProjectSnapshot}
        initialProgress={initialProgress}
      />,
    );

    expect(screen.getByRole("heading", { name: "设定工坊" })).toBeInTheDocument();
    expect(routerReplaceMock).toHaveBeenCalledWith("/projects/project-1?tab=chat", { scroll: false });
  });

  it("respects an explicit outline tab even for brand-new projects", () => {
    setPathnameMock("/projects/project-1");
    setSearchParamsMock("tab=outline");

    renderWithProviders(
      <ProjectDetailClient
        projectId="project-1"
        initialSnapshot={newProjectSnapshot}
        initialProgress={initialProgress}
      />,
    );

    expect(screen.getByRole("heading", { name: "章节结构" })).toBeInTheDocument();
    expect(routerReplaceMock).not.toHaveBeenCalled();
  });

  it("restores the workspace tab from project-scoped localStorage when the URL is silent", () => {
    setPathnameMock("/projects/project-1");
    setSearchParamsMock("");
    window.localStorage.setItem(getProjectWorkspaceTabStorageKey("project-1"), "models");

    renderWithProviders(
      <ProjectDetailClient
        projectId="project-1"
        initialSnapshot={initialSnapshot}
        initialProgress={initialProgress}
      />,
    );

    expect(screen.getAllByRole("heading", { name: "模型分配" })).toHaveLength(2);
    expect(routerReplaceMock).toHaveBeenCalledWith("/projects/project-1?tab=models", { scroll: false });
  });

  it("warns and clears invalid project-scoped localStorage tab values", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    setPathnameMock("/projects/project-1");
    setSearchParamsMock("");
    window.localStorage.setItem(getProjectWorkspaceTabStorageKey("project-1"), "broken-tab");

    renderWithProviders(
      <ProjectDetailClient
        projectId="project-1"
        initialSnapshot={initialSnapshot}
        initialProgress={initialProgress}
      />,
    );

    expect(screen.getByRole("heading", { name: "章节结构" })).toBeInTheDocument();
    expect(window.localStorage.getItem(getProjectWorkspaceTabStorageKey("project-1"))).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("shows a resume action for recoverable stopped progress", () => {
    renderWithProviders(
      <ProjectDetailClient
        projectId="project-1"
        initialSnapshot={initialSnapshot}
        initialProgress={{
          ...initialProgress,
          stage: "interrupted",
          desiredState: "stopped",
          running: false,
          recoverable: true,
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "从第 3 章恢复写作" })).toBeInTheDocument();
  });

  it("does not render a blocking page overlay when the right panel is opened", () => {
    const { container } = renderWithProviders(
      <ProjectDetailClient
        projectId="project-1"
        initialSnapshot={initialSnapshot}
        initialProgress={initialProgress}
      />,
    );

    fireEvent.click(screen.getByTitle("打开项目信息面板"));

    expect(container.querySelector("div.fixed.inset-0.z-30")).toBeNull();
  });

  it("disables the primary run action and surfaces the blocking reason when the project has core drift", () => {
    renderWithProviders(
      <ProjectDetailClient
        projectId="project-1"
        initialSnapshot={driftingSnapshot}
        initialProgress={initialProgress}
      />,
    );

    fireEvent.click(screen.getByTitle("打开项目信息面板"));

    expect(screen.getByRole("button", { name: "开始写作" })).toBeDisabled();
    expect(
      screen.getAllByText("检测到设定工坊中的核心事实尚未整理为正式设定，请先整理正式设定后再开始自动写作。").length,
    ).toBeGreaterThan(0);
  });
});
