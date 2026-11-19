"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { PlusCircle, Trash2 } from "lucide-react";
import { TaffyMark } from "./taffy-mark";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api";
import { buildNewProjectWorkspaceHref } from "@/lib/project-navigation";
import { LoadingSkeleton } from "./loading-skeleton";
import {
  buildProjectStructureSummary,
  type ChapterPlanningMode,
  getNarrativePersonLabel,
  getStoryLengthLabel,
  type PaceProfile,
  type StoryLength,
} from "@/lib/project-structure";
import type {
  LlmProfile,
  ProjectSummary,
} from "@/lib/types";
import { BouncyTitle } from "./bouncy-title";
import { CollapsibleSection } from "./collapsible-section.tsx";
import { ProjectCreationForm } from "./dashboard/project-creation-form.tsx";
import { toneAt } from "./tone";
import { useCardTilt } from "./use-card-tilt";
import {
  createDefaultAssignments,
  normalizeAssignments,
  type RoleAssignmentValue,
} from "./role-assignment-editor.tsx";
import { StatusBadge } from "./status-badge.tsx";
import { useToast } from "./toast.tsx";
import { TrashPanelClient } from "./trash-panel-client.tsx";
import { usePopReveal } from "./use-pop-reveal";

const presetGenres = [
  "现代悬疑",
  "古代言情",
  "都市异能",
  "玄幻修仙",
  "科幻未来",
  "历史军事",
  "职场商战",
];

const dynamicBudgetPresets: Record<Exclude<StoryLength, "short">, Record<PaceProfile, { target: number; max: number }>> = {
  medium: {
    fast: { target: 4, max: 6 },
    medium: { target: 6, max: 8 },
    slow: { target: 8, max: 10 },
  },
  long: {
    fast: { target: 7, max: 10 },
    medium: { target: 10, max: 14 },
    slow: { target: 13, max: 18 },
  },
};

function getDefaultCompletionCriteria(storyLength: StoryLength) {
  if (storyLength === "short") {
    return "单次冲突闭环，情绪落点清晰，不额外外扩支线。";
  }
  if (storyLength === "medium") {
    return "主线冲突闭环，关键伏笔有交代，主要人物关系落到稳定结局。";
  }
  return "主线承诺兑现，关键伏笔回收，主要人物命运落定，并自然完成终局收束。";
}

function getDynamicPreset(storyLength: StoryLength, paceProfile: PaceProfile, plannedVolumes: number) {
  if (storyLength === "short") {
    return { targetChapters: 1, hardChapterCap: 1 };
  }
  const preset = dynamicBudgetPresets[storyLength][paceProfile];
  return {
    targetChapters: preset.target * plannedVolumes,
    hardChapterCap: preset.max * plannedVolumes,
  };
}

function getFixedDefaultTarget(storyLength: StoryLength, plannedVolumes: number) {
  if (storyLength === "short") {
    return 1;
  }
  return storyLength === "medium" ? Math.max(6, plannedVolumes * 4) : Math.max(10, plannedVolumes * 8);
}

function getPaceLabel(paceProfile: PaceProfile) {
  if (paceProfile === "fast") {
    return "快节奏";
  }
  if (paceProfile === "slow") {
    return "慢节奏";
  }
  return "中节奏";
}

export function DashboardClient({
  initialProfiles,
  initialProjects,
}: {
  initialProfiles?: { profiles: LlmProfile[] };
  initialProjects?: { projects: ProjectSummary[] };
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState("");
  const style = "default";
  const [seriesMode, setSeriesMode] = useState<ProjectSummary["seriesMode"]>("standalone");
  const [seriesTitle, setSeriesTitle] = useState("");
  const [seriesIndex, setSeriesIndex] = useState(1);
  const [storyLength, setStoryLength] = useState<StoryLength>("long");
  const [narrativePerson, setNarrativePerson] = useState<ProjectSummary["narrativePerson"]>("third");
  const [chapterPlanningMode, setChapterPlanningMode] = useState<ChapterPlanningMode>("dynamic");
  const [plannedVolumes, setPlannedVolumes] = useState(2);
  const [paceProfile, setPaceProfile] = useState<PaceProfile>("medium");
  const [targetChapters, setTargetChapters] = useState(16);
  const [hardChapterCap, setHardChapterCap] = useState(28);
  const [completionCriteria, setCompletionCriteria] = useState(() => getDefaultCompletionCriteria("long"));
  const [premise, setPremise] = useState("");
  const [assignmentsDraft, setAssignmentsDraft] = useState<RoleAssignmentValue[] | null>(null);
  const [showTrash, setShowTrash] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const { data: profileData } = useQuery({
    queryKey: ["profiles"],
    queryFn: () => apiGet<{ profiles: LlmProfile[] }>("/api/settings/llm-profiles"),
    initialData: initialProfiles,
    refetchOnMount: false,
  });

  // initialData 保证首屏不闪烁；保留默认 refetchOnMount，让删除/新建项目后
  // 其他页面发出的 invalidate 在回到总览时能真正触发重拉。
  const { data: projectData, isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiGet<{ projects: ProjectSummary[] }>("/api/projects"),
    initialData: initialProjects,
  });

  const assignments = !profileData?.profiles.length
    ? ([] as RoleAssignmentValue[])
    : !assignmentsDraft?.length
      ? createDefaultAssignments(profileData.profiles)
      : normalizeAssignments(assignmentsDraft, profileData.profiles);

  const groupedProjects = useMemo(() => {
    const projects = projectData?.projects ?? [];
    const seriesGroups = new Map<string, ProjectSummary[]>();
    const standaloneLong: ProjectSummary[] = [];
    const standaloneMedium: ProjectSummary[] = [];
    const standaloneShort: ProjectSummary[] = [];

    for (const project of projects) {
      if (project.seriesMode === "series" && project.seriesTitle) {
        const bucket = seriesGroups.get(project.seriesTitle) ?? [];
        bucket.push(project);
        seriesGroups.set(project.seriesTitle, bucket);
        continue;
      }

      if (project.storyLength === "short") {
        standaloneShort.push(project);
      } else if (project.storyLength === "medium") {
        standaloneMedium.push(project);
      } else {
        standaloneLong.push(project);
      }
    }

    const orderedSeriesGroups = Array.from(seriesGroups.entries())
      .map(([seriesName, items]) => ({
        seriesName,
        items: items.sort((left, right) => {
          if ((left.seriesIndex ?? 0) !== (right.seriesIndex ?? 0)) {
            return (left.seriesIndex ?? 0) - (right.seriesIndex ?? 0);
          }
          return (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "");
        }),
      }))
      .sort((left, right) => left.seriesName.localeCompare(right.seriesName, "zh-CN"));

    return {
      series: orderedSeriesGroups,
      standaloneLong,
      standaloneMedium,
      standaloneShort,
    };
  }, [projectData?.projects]);

  const projectSections = useMemo(() => {
    const sections: Array<{
      id: string;
      eyebrow: string;
      title: string;
      items: ProjectSummary[];
    }> = [];

    for (const group of groupedProjects.series) {
      sections.push({
        id: `series-${group.seriesName}`,
        eyebrow: "系列",
        title: group.seriesName,
        items: group.items,
      });
    }

    if (groupedProjects.standaloneLong.length > 0) {
      sections.push({
        id: "standalone-long",
        eyebrow: "长篇",
        title: "单部长篇",
        items: groupedProjects.standaloneLong,
      });
    }

    if (groupedProjects.standaloneMedium.length > 0) {
      sections.push({
        id: "standalone-medium",
        eyebrow: "中篇",
        title: "单部中篇",
        items: groupedProjects.standaloneMedium,
      });
    }

    if (groupedProjects.standaloneShort.length > 0) {
      sections.push({
        id: "standalone-short",
        eyebrow: "短篇",
        title: "单部短篇",
        items: groupedProjects.standaloneShort,
      });
    }

    return sections;
  }, [groupedProjects]);

  const effectivePlanningMode: ChapterPlanningMode = storyLength === "short" ? "fixed" : chapterPlanningMode;
  const hasVolumes = storyLength !== "short" && plannedVolumes > 1;
  const planPreview = useMemo(() => {
    if (storyLength === "short") {
      return "短篇单单元模式";
    }
    const forecast = effectivePlanningMode === "fixed"
      ? `固定 ${targetChapters} 章`
      : `预计 ${getDynamicPreset(storyLength, paceProfile, plannedVolumes).targetChapters}-${hardChapterCap} 章`;
    return `${plannedVolumes} 卷 · ${getPaceLabel(paceProfile)} · ${forecast}`;
  }, [effectivePlanningMode, hardChapterCap, paceProfile, plannedVolumes, storyLength, targetChapters]);

  const createMutation = useMutation({
    mutationFn: () =>
      apiPost<{ project: ProjectSummary }>("/api/projects", {
        title,
        genre,
        style,
        seriesMode,
        seriesTitle: seriesMode === "series" ? seriesTitle : "",
        seriesIndex: seriesMode === "series" ? seriesIndex : undefined,
        storyLength,
        narrativePerson,
        chapterPlanningMode: effectivePlanningMode,
        hasVolumes: storyLength !== "short" ? hasVolumes : false,
        plannedVolumes: storyLength !== "short" ? plannedVolumes : undefined,
        paceProfile: storyLength !== "short" ? paceProfile : undefined,
        completionCriteria: completionCriteria.trim(),
        hardChapterCap: storyLength !== "short" && effectivePlanningMode === "dynamic" ? hardChapterCap : undefined,
        targetChapters: storyLength !== "short" && effectivePlanningMode === "fixed" ? targetChapters : undefined,
        premise,
        assignments,
      }),
    onSuccess: ({ project }) => {
      toast("项目已创建", "success");
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      router.push(buildNewProjectWorkspaceHref(project.id));
    },
    onError: (error) => toast(error instanceof Error ? error.message : "创建项目失败", "error"),
  });

  const renderProjectCard = (project: ProjectSummary, index: number) => (
    <Link
      key={project.id}
      href={`/projects/${project.id}`}
      data-reveal-scroll
      data-tilt
      data-tone={toneAt(index)}
      className="scroll-container tone-card group relative flex min-h-[23rem] flex-col rounded-2xl px-6 py-6 hover:bg-[var(--hover)]"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-wrap gap-2">
          <span className="workspace-pill px-3 py-1 text-xs text-[var(--ink-soft)]">
            {getStoryLengthLabel(project.storyLength)}
          </span>
          <span className="workspace-pill px-3 py-1 text-xs text-[var(--ink-soft)]">
            {project.genre || "未分类"}
          </span>
          {project.seriesMode === "series" ? (
            <span className="seal-h text-[10px]">
              {project.seriesIndex ? `系列 ${String(project.seriesIndex).padStart(2, "0")}` : "系列"}
            </span>
          ) : (
            <span className="workspace-pill px-3 py-1 text-xs text-[var(--ink-soft)]">单作</span>
          )}
        </div>
        <div className="shrink-0">
          <StatusBadge status={project.status} />
        </div>
      </div>

      <div className="mt-7">
        <h3 className="line-clamp-2 text-[2rem] font-semibold leading-[1.2] tracking-[0.08em] text-[var(--ink)] transition-colors duration-500 group-hover:text-[var(--tone)] [font-family:var(--font-serif)]">
          {project.title}
        </h3>
        <p className="mt-4 line-clamp-3 min-h-[4.5rem] text-sm leading-7 text-[var(--ink-soft)]">
          {(project.premise || "").trim() || "尚未填写故事前提，可进入项目后继续补全。"}
        </p>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-2">
        <div className="workspace-item active rounded-[20px] px-4 py-4">
          <p className="section-title">结构</p>
          <p className="mt-2 text-sm font-medium text-[var(--ink)]">
            {project.plannedVolumes ? `${project.plannedVolumes} 卷规划` : "单卷结构"}
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">
            {project.chapterPlanningMode === "fixed"
              ? `固定 ${project.targetChapters} 章`
              : `预计 ${project.chapterBudgetMin}-${project.chapterBudgetMax} 章`}
          </p>
        </div>
        <div className="workspace-item active rounded-[20px] px-4 py-4">
          <p className="section-title">叙事</p>
          <p className="mt-2 text-sm font-medium text-[var(--ink)]">
            {getNarrativePersonLabel(project.narrativePerson)}
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">
            {project.storyLength === "short" ? "单单元流程" : getPaceLabel(project.paceProfile)}
          </p>
        </div>
      </div>

      <div className="mt-5 border-t border-[var(--line)] pt-4">
        <p className="text-xs leading-6 text-[var(--ink-soft)]">
          {buildProjectStructureSummary(project)}
        </p>
      </div>

      <div className="mt-auto flex items-end justify-between gap-4 pt-5">
        <div>
          <p className="text-[11px] tracking-[0.18em] text-[var(--ink-soft)]">最近更新</p>
          <p className="mt-1 font-mono text-xs text-[var(--ink)]">
            {project.updatedAt ? new Date(project.updatedAt).toLocaleDateString("zh-CN") : "未知"}
          </p>
        </div>
        <span className="text-xs tracking-[0.22em] text-[var(--tone)]">进入工作台</span>
      </div>
    </Link>
  );

  const totalProjects = projectData?.projects.length ?? 0;
  const seriesCount = groupedProjects.series.length;
  const workspaceMode = showTrash ? "回收站" : showCreate ? "新建项目" : "项目总览";

  const revealScope = useRef<HTMLDivElement>(null);
  usePopReveal(revealScope);
  useCardTilt(revealScope, [projectData, showTrash, showCreate]);

  return (
    <div ref={revealScope} className="min-h-screen w-full px-6 py-8">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-6">
        <section data-reveal className="workspace-panel candy-top overflow-hidden px-8 py-10">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1.25fr)_360px] lg:items-end">
            <div>
              <p className="section-title">项目库</p>
              <BouncyTitle
                text="项目总览"
                className="mt-3 text-4xl font-semibold tracking-[0.08em] text-[var(--ink)] [font-family:var(--font-serif)] md:text-5xl"
              />
              <p className="mt-4 max-w-3xl text-sm leading-8 text-[var(--ink-soft)] md:text-[15px]">
                在这里统一管理所有项目、系列和回收站。每一本书的进度 taffy 都帮你看着，创建、归档、恢复随时都可以喵。
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <span className="workspace-pill px-4 py-2 text-sm text-[var(--ink-soft)]">
                  当前面板 · {workspaceMode}
                </span>
                <span className="workspace-pill px-4 py-2 text-sm text-[var(--ink-soft)]">
                  项目 {totalProjects}
                </span>
                <span className="workspace-pill px-4 py-2 text-sm text-[var(--ink-soft)]">
                  系列 {seriesCount}
                </span>
              </div>
            </div>

            <div className="scroll-container p-6">
              <div className="grid gap-4">
                <div className="grid grid-cols-3 gap-3">
                  <div className="workspace-item active px-4 py-4 text-center">
                    <p className="section-title">项目</p>
                    <p className="mt-3 text-3xl font-semibold text-[var(--tint-pink)] [font-family:var(--font-serif)]">{totalProjects}</p>
                  </div>
                  <div className="workspace-item active px-4 py-4 text-center">
                    <p className="section-title">系列</p>
                    <p className="mt-3 text-3xl font-semibold text-[var(--tint-violet)] [font-family:var(--font-serif)]">{seriesCount}</p>
                  </div>
                  <div className="workspace-item active px-4 py-4 text-center">
                    <p className="section-title">面板</p>
                    <p className="mt-3 text-base font-semibold text-[var(--tint-sky)] [font-family:var(--font-serif)]">{workspaceMode}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => {
                      setShowCreate(true);
                      setShowTrash(false);
                    }}
                    className="btn-primary flex-1"
                  >
                    <PlusCircle className="h-4 w-4" />
                    新建项目
                  </button>
                  <button
                    onClick={() => {
                      setShowTrash((current) => !current);
                      setShowCreate(false);
                    }}
                    className="btn-secondary flex-1"
                  >
                    <Trash2 className="h-4 w-4" />
                    {showTrash ? "关闭回收站" : "打开回收站"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {showTrash ? (
          <section className="workspace-panel anim-pop-in p-6">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="section-title">回收站</p>
                <h2 className="mt-1 text-2xl font-semibold [font-family:var(--font-serif)]">回收站</h2>
              </div>
              <button onClick={() => setShowTrash(false)} className="btn-ghost text-xs">关闭</button>
            </div>
            <TrashPanelClient />
          </section>
        ) : showCreate ? (
          <div className="anim-pop-in">
          <ProjectCreationForm
            presetGenres={presetGenres}
            state={{
              title,
              genre,
              seriesMode,
              seriesTitle,
              seriesIndex,
              storyLength,
              narrativePerson,
              plannedVolumes,
              paceProfile,
              completionCriteria,
              effectivePlanningMode,
              targetChapters,
              hardChapterCap,
              premise,
              showAdvanced,
            }}
            handlers={{
              onCancel: () => setShowCreate(false),
              onCreate: () => createMutation.mutate(),
              onTitleChange: setTitle,
              onGenreChange: setGenre,
              onSeriesModeChange: setSeriesMode,
              onSeriesTitleChange: setSeriesTitle,
              onSeriesIndexChange: (value) => setSeriesIndex(value),
              onStoryLengthChange: (next) => {
                const currentDefaultCriteria = getDefaultCompletionCriteria(storyLength);
                const nextVolumes = storyLength === "short" ? 2 : plannedVolumes;
                const nextDynamicPreset = getDynamicPreset(next, paceProfile, nextVolumes);
                setStoryLength(next);
                if (completionCriteria.trim() === currentDefaultCriteria) {
                  setCompletionCriteria(getDefaultCompletionCriteria(next));
                }
                if (next === "short") {
                  setChapterPlanningMode("fixed");
                  setPlannedVolumes(1);
                  setTargetChapters(1);
                  setHardChapterCap(1);
                } else {
                  if (storyLength === "short") {
                    setChapterPlanningMode("dynamic");
                    setPlannedVolumes(nextVolumes);
                  }
                  setTargetChapters(getFixedDefaultTarget(next, nextVolumes));
                  setHardChapterCap(nextDynamicPreset.hardChapterCap);
                }
              },
              onNarrativePersonChange: setNarrativePerson,
              onPlannedVolumesChange: (value) => {
                const nextVolumes = Math.min(24, Math.max(1, value || 1));
                const nextDynamicPreset = getDynamicPreset(storyLength, paceProfile, nextVolumes);
                setPlannedVolumes(nextVolumes);
                if (effectivePlanningMode === "fixed") {
                  setTargetChapters(getFixedDefaultTarget(storyLength, nextVolumes));
                } else {
                  setHardChapterCap(nextDynamicPreset.hardChapterCap);
                }
              },
              onPaceProfileChange: (nextPace) => {
                const nextDynamicPreset = getDynamicPreset(storyLength, nextPace, plannedVolumes);
                setPaceProfile(nextPace);
                if (effectivePlanningMode === "dynamic") {
                  setHardChapterCap(nextDynamicPreset.hardChapterCap);
                }
              },
              onCompletionCriteriaChange: setCompletionCriteria,
              onShowAdvancedToggle: () => setShowAdvanced((current) => !current),
              onPlanningModeChange: (nextMode) => {
                setChapterPlanningMode(nextMode);
                if (nextMode === "fixed") {
                  setTargetChapters(getFixedDefaultTarget(storyLength, plannedVolumes));
                } else {
                  setHardChapterCap(getDynamicPreset(storyLength, paceProfile, plannedVolumes).hardChapterCap);
                }
              },
              onTargetChaptersChange: (value) => setTargetChapters(Math.min(200, Math.max(1, value || 1))),
              onHardChapterCapChange: (value) => setHardChapterCap(Math.min(200, Math.max(1, value || 1))),
              onPremiseChange: setPremise,
              onAssignmentsChange: setAssignmentsDraft,
            }}
            profiles={profileData?.profiles ?? []}
            assignments={assignments}
            planPreview={planPreview}
            narrativePersonLabel={getNarrativePersonLabel(narrativePerson)}
            createPending={createMutation.isPending}
            createDisabled={
              !title.trim()
              || !genre.trim()
              || (seriesMode === "series" && !seriesTitle.trim())
              || (storyLength !== "short" && !completionCriteria.trim())
              || createMutation.isPending
            }
          />
          </div>
        ) : isLoading ? (
          <LoadingSkeleton variant="card" count={3} />
        ) : !totalProjects ? (
          <section className="workspace-panel anim-pop-in mx-auto max-w-4xl p-10">
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="taffy-chip float-y mb-4 flex h-16 w-16 items-center justify-center overflow-hidden rounded-3xl">
                <TaffyMark size={64} className="h-16 w-16" />
              </div>
              <h2 className="gradient-text mt-2 text-3xl font-semibold [font-family:var(--font-serif)]">从第一个项目开始喵</h2>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--ink-soft)]">
                项目一旦建立，后面的设定、卡片、章节与预览都会接到同一条工作链路里。
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <button onClick={() => setShowCreate(true)} className="btn-primary">
                  <PlusCircle className="h-4 w-4" />
                  新建项目
                </button>
                <button onClick={() => setShowTrash(true)} className="btn-secondary">
                  <Trash2 className="h-4 w-4" />
                  打开回收站
                </button>
              </div>
            </div>
          </section>
        ) : (
          <div className="anim-pop-in grid gap-6">
            {projectSections.map((section, index) => (
              <section key={section.id} className="workspace-panel p-6">
                <CollapsibleSection
                  eyebrow={section.eyebrow}
                  title={section.title}
                  defaultOpen={index === 0}
                  summaryRight={(
                    <span className="workspace-pill px-2.5 py-1 text-xs text-[var(--ink-soft)]">
                      {section.items.length} 个
                    </span>
                  )}
                  bodyClassName="mt-6 grid gap-6 md:grid-cols-2 xl:grid-cols-3"
                >
                  {section.items.map(renderProjectCard)}
                </CollapsibleSection>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
