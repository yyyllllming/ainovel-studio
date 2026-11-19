import { NextRequest, NextResponse } from "next/server";

// 模拟项目数据
const mockProjects = [
  {
    id: "proj_123",
    title: "雾港奇案",
    genre: "现代悬疑",
    style: "default",
    targetChapters: 16,
    premise: "一名年轻记者调查港口神秘失踪案件，揭露隐藏在迷雾背后的真相",
    seriesMode: "standalone",
    seriesTitle: null,
    seriesIndex: null,
    storyLength: "long",
    narrativePerson: "third",
    chapterPlanningMode: "dynamic",
    paceProfile: "medium",
    completionCriteria: "主线冲突闭环，关键伏笔全部回收，并自然收束到终局",
    chapterBudgetMin: 8000,
    chapterBudgetTarget: 12000,
    chapterBudgetMax: 20000,
    hardChapterCap: 28,
    hasVolumes: true,
    plannedVolumes: 2,
    status: "planning",
    deletedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "proj_456",
    title: "宫廷画师",
    genre: "古代言情",
    style: "default",
    targetChapters: 24,
    premise: "一位宫廷画师在后宫的传奇经历，见证权力与爱情的交织",
    seriesMode: "series",
    seriesTitle: "后宫传奇",
    seriesIndex: 1,
    storyLength: "long",
    narrativePerson: "first",
    chapterPlanningMode: "fixed",
    paceProfile: "slow",
    completionCriteria: "主角在宫廷中的成长和蜕变，情感线圆满",
    chapterBudgetMin: 10000,
    chapterBudgetTarget: 15000,
    chapterBudgetMax: 25000,
    hardChapterCap: 24,
    hasVolumes: true,
    plannedVolumes: 3,
    status: "drafting",
    deletedAt: null,
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: "proj_789",
    title: "星途",
    genre: "科幻未来",
    style: "default",
    targetChapters: 8,
    premise: "人类首次星际旅行，探索未知宇宙的故事",
    seriesMode: "standalone",
    seriesTitle: null,
    seriesIndex: null,
    storyLength: "medium",
    narrativePerson: "third",
    chapterPlanningMode: "fixed",
    paceProfile: "fast",
    completionCriteria: "完成星际旅行的目标，揭示宇宙的奥秘",
    chapterBudgetMin: 5000,
    chapterBudgetTarget: 8000,
    chapterBudgetMax: 12000,
    hardChapterCap: 8,
    hasVolumes: false,
    plannedVolumes: null,
    status: "reviewing",
    deletedAt: null,
    createdAt: new Date(Date.now() - 172800000).toISOString(),
    updatedAt: new Date(Date.now() - 1800000).toISOString(),
  },
];

// 模拟章节数据
const mockChapters = [
  {
    chapterNo: 1,
    title: "第一章：港口迷雾",
    status: "drafting",
    content: "清晨的雾港被一层厚厚的迷雾笼罩着，码头上只有零星的几个工人在忙碌...",
    wordCount: 1200,
    updatedAt: new Date().toISOString(),
  },
  {
    chapterNo: 2,
    title: "第二章：匿名电话",
    status: "planning",
    content: "",
    wordCount: 0,
    updatedAt: new Date(Date.now() - 3600000).toISOString(),
  },
];

// 模拟配置文件
const mockProfiles = [
  {
    id: "profile_1",
    name: "GPT-4o",
    defaultModel: "gpt-4o",
    baseUrl: "https://api.openai.com/v1",
  },
  {
    id: "profile_2",
    name: "Claude 3 Opus",
    defaultModel: "claude-3-opus-20240229",
    baseUrl: "https://api.anthropic.com",
  },
];

// 演示路由仅用于本地开发预览，不代表真实契约；生产构建直接 404。
function demoDisabledInProduction() {
  return process.env.NODE_ENV === "production"
    ? new Response(null, { status: 404 })
    : null;
}

export async function GET(request: NextRequest) {
  const disabled = demoDisabledInProduction();
  if (disabled) {
    return disabled;
  }
  const searchParams = request.nextUrl.searchParams;
  const endpoint = searchParams.get("endpoint");

  switch (endpoint) {
    case "projects":
      return NextResponse.json({ projects: mockProjects });
    case "chapters":
      return NextResponse.json({ chapters: mockChapters });
    case "profiles":
      return NextResponse.json({ profiles: mockProfiles });
    case "project-detail":
      const id = searchParams.get("id");
      const project = mockProjects.find((p) => p.id === id);
      return NextResponse.json({ project });
    case "api-docs":
      return NextResponse.json({
        endpoints: [
          {
            method: "GET",
            path: "/api/projects",
            description: "获取所有项目",
          },
          {
            method: "POST",
            path: "/api/projects",
            description: "创建新项目",
          },
          {
            method: "GET",
            path: "/api/projects/{projectId}",
            description: "获取项目详情",
          },
          {
            method: "DELETE",
            path: "/api/projects/{projectId}",
            description: "删除项目",
          },
          {
            method: "GET",
            path: "/api/projects/{projectId}/chapters",
            description: "获取章节列表",
          },
          {
            method: "GET",
            path: "/api/projects/{projectId}/chapters/{chapterNo}",
            description: "获取章节详情",
          },
          {
            method: "POST",
            path: "/api/projects/{projectId}/chapters/{chapterNo}",
            description: "编写章节",
          },
          {
            method: "POST",
            path: "/api/projects/{projectId}/chapters/{chapterNo}/optimize",
            description: "优化章节",
          },
          {
            method: "POST",
            path: "/api/projects/{projectId}/chapters/{chapterNo}/review",
            description: "自动审稿",
          },
          {
            method: "GET",
            path: "/api/settings/llm-profiles",
            description: "获取LLM配置文件",
          },
        ],
      });
    default:
      return NextResponse.json({
        message: "AINovel Studio API Demo",
        endpoints: [
          {
            name: "Projects",
            path: "/api/demo?endpoint=projects",
            description: "获取项目列表",
          },
          {
            name: "Chapters",
            path: "/api/demo?endpoint=chapters&projectId=proj_123",
            description: "获取章节列表",
          },
          {
            name: "Profiles",
            path: "/api/demo?endpoint=profiles",
            description: "获取LLM配置文件",
          },
          {
            name: "API Documentation",
            path: "/api/demo?endpoint=api-docs",
            description: "获取API文档",
          },
        ],
      });
  }
}

export async function POST(request: Request) {
  const disabled = demoDisabledInProduction();
  if (disabled) {
    return disabled;
  }
  const searchParams = new URL(request.url).searchParams;
  const endpoint = searchParams.get("endpoint");

  switch (endpoint) {
    case "create-project":
      const body = await request.json().catch(() => ({}));
      const newProject = {
        id: `proj_${Date.now()}`,
        title: body.title || "新小说项目",
        genre: body.genre || "现代悬疑",
        style: "default",
        targetChapters: 16,
        premise: body.premise || "一个精彩的故事",
        seriesMode: body.seriesMode || "standalone",
        seriesTitle: body.seriesTitle || null,
        seriesIndex: body.seriesIndex || null,
        storyLength: body.storyLength || "long",
        narrativePerson: body.narrativePerson || "third",
        chapterPlanningMode: body.chapterPlanningMode || "dynamic",
        paceProfile: body.paceProfile || "medium",
        completionCriteria: body.completionCriteria || "主线冲突闭环",
        chapterBudgetMin: 8000,
        chapterBudgetTarget: 12000,
        chapterBudgetMax: 20000,
        hardChapterCap: 28,
        hasVolumes: body.hasVolumes || false,
        plannedVolumes: body.plannedVolumes || 1,
        status: "planning",
        deletedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      return NextResponse.json({ project: newProject });
    default:
      return NextResponse.json({ error: "Unknown endpoint" }, { status: 400 });
  }
}
