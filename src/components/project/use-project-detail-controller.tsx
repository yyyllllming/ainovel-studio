import { useCallback, useEffect, useMemo, useState } from "react";
import {
  usePathname,
  useRouter,
  useSearchParams,
  type ReadonlyURLSearchParams,
} from "next/navigation";
import { Bot, BookOpenText, FilePenLine, Globe2, MessageSquareDashed, UserRound } from "lucide-react";
import type {
  LlmProfile,
  ProjectCardSummary,
  ProjectDetail,
  ProjectRunProgress,
  ReviewPolicyDraft,
  SteeringNoteScope,
} from "@/lib/types";
import type { NarrativePerson } from "@/lib/project-structure";
import { buildProjectStructureSummary, getNarrativePersonLabel, getProjectUnitLabel } from "@/lib/project-structure";
import { useConfirm } from "../confirm-dialog";
import { normalizeAssignments, type RoleAssignmentValue } from "../role-assignment-editor";
import { useProjectQueries, type WorkspaceTab } from "./use-project-queries";

const DEFAULT_WORKSPACE_TAB: WorkspaceTab = "outline";
const WORKSPACE_TAB_PARAM = "tab";
const WORKSPACE_TAB_SET = new Set<WorkspaceTab>([
  "chat",
  "characterBook",
  "worldBook",
  "outline",
  "authorSubmissions",
  "models",
]);

function isWorkspaceTab(value: string | null | undefined): value is WorkspaceTab {
  return Boolean(value) && WORKSPACE_TAB_SET.has(value as WorkspaceTab);
}

export function isBrandNewProjectWorkspace(snapshot: ProjectDetail | null | undefined) {
  if (!snapshot) {
    return false;
  }
  return !snapshot.foundationLocked && snapshot.writtenChapters.length === 0;
}

export function resolveWorkspaceDefaultTab(snapshot: ProjectDetail | null | undefined): WorkspaceTab {
  return isBrandNewProjectWorkspace(snapshot) ? "chat" : DEFAULT_WORKSPACE_TAB;
}

export function resolveWorkspaceTab(
  value: string | null | undefined,
  fallback: WorkspaceTab = DEFAULT_WORKSPACE_TAB,
): WorkspaceTab {
  if (isWorkspaceTab(value)) {
    return value;
  }
  return fallback;
}

export function getProjectWorkspaceTabStorageKey(projectId: string) {
  return `ainovel:project-workspace-tab:${projectId}`;
}

function getWorkspaceTabStorage() {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage;
}

export function readProjectWorkspaceTabPreference(projectId: string) {
  const storage = getWorkspaceTabStorage();
  if (!storage) {
    return null;
  }

  const key = getProjectWorkspaceTabStorageKey(projectId);
  try {
    const raw = storage.getItem(key);
    if (!raw) {
      return null;
    }
    if (isWorkspaceTab(raw)) {
      return raw;
    }
    console.warn(`[project-workspace-tab] invalid stored tab for ${projectId}: ${raw}`);
    storage.removeItem(key);
    return null;
  } catch {
    return null;
  }
}

export function writeProjectWorkspaceTabPreference(projectId: string, tab: WorkspaceTab) {
  const storage = getWorkspaceTabStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(getProjectWorkspaceTabStorageKey(projectId), tab);
  } catch {
    // localStorage is best-effort only; workspace rendering should continue.
  }
}

export function buildWorkspaceTabHref(
  pathname: string,
  searchParams: URLSearchParams | ReadonlyURLSearchParams,
  tab: WorkspaceTab,
  options?: { forceExplicit?: boolean },
) {
  const nextSearchParams = new URLSearchParams(searchParams.toString());
  if (!options?.forceExplicit && tab === DEFAULT_WORKSPACE_TAB) {
    nextSearchParams.delete(WORKSPACE_TAB_PARAM);
  } else {
    nextSearchParams.set(WORKSPACE_TAB_PARAM, tab);
  }

  const query = nextSearchParams.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function getCurrentMilestone(
  storyContract: ProjectDetail["storyContract"],
  currentVolumeNo: number,
  chapterNo: number,
) {
  const volume = storyContract?.volumes.find((item) => item.volumeNo === currentVolumeNo);
  if (!volume?.milestones?.length) {
    return null;
  }

  const activeMilestone = volume.milestones.find((milestone) => milestone.status === "active");
  if (activeMilestone) {
    return activeMilestone;
  }

  const rangedMilestone = volume.milestones.find((milestone) => {
    const start = milestone.expectedChapterStart ?? Number.MIN_SAFE_INTEGER;
    const end = milestone.expectedChapterEnd ?? Number.MAX_SAFE_INTEGER;
    return chapterNo >= start && chapterNo <= end;
  });

  return rangedMilestone ?? volume.milestones.find((milestone) => milestone.status !== "completed") ?? volume.milestones[0] ?? null;
}

export function useProjectDetailController({
  projectId,
  initialSnapshot,
  initialProgress,
  initialProfiles,
  initialCards,
}: {
  projectId: string;
  initialSnapshot?: ProjectDetail | null;
  initialProgress?: ProjectRunProgress | null;
  initialProfiles?: { profiles: LlmProfile[] };
  initialCards?: { cards: ProjectCardSummary[]; candidateCount?: number };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { confirm } = useConfirm();
  const rawTabParam = searchParams.get(WORKSPACE_TAB_PARAM);
  const explicitTab: WorkspaceTab | null = isWorkspaceTab(rawTabParam)
    ? rawTabParam
    : null;
  const initialDefaultTab = resolveWorkspaceDefaultTab(initialSnapshot ?? null);
  const storedTab = explicitTab ? null : readProjectWorkspaceTabPreference(projectId);
  const preferredInitialTab = explicitTab ?? storedTab ?? initialDefaultTab;
  const [assignmentsDraft, setAssignmentsDraft] = useState<RoleAssignmentValue[] | null>(null);
  const [reviewPolicyDraft, setReviewPolicyDraft] = useState<ReviewPolicyDraft | null>(null);
  const [activeTab, setActiveTabState] = useState<WorkspaceTab>(preferredInitialTab);
  const [showRightPanel, setShowRightPanel] = useState(false);
  const [deleteRange, setDeleteRange] = useState({ startChapter: 0, endChapter: 0 });
  const [steeringInstruction, setSteeringInstruction] = useState("");
  const [steeringScope, setSteeringScope] = useState<SteeringNoteScope>("next_arc");
  const [narrativePersonDraft, setNarrativePersonDraft] = useState<NarrativePerson | null>(null);

  const {
    snapshotQuery,
    progressQuery,
    profilesQuery,
    cardsQuery,
    simpleMutation,
    saveAssignmentsMutation,
    saveReviewPolicyMutation,
    saveNarrativePersonMutation,
    steeringMutation,
  } = useProjectQueries(
    projectId,
    activeTab,
    showRightPanel,
    initialSnapshot,
    initialProgress,
    initialProfiles,
    initialCards,
  );
  const tabSnapshot = snapshotQuery.data ?? initialSnapshot ?? null;
  const defaultWorkspaceTab = resolveWorkspaceDefaultTab(tabSnapshot);
  const shouldForceExplicitTab = isBrandNewProjectWorkspace(tabSnapshot);
  const rememberedTab = explicitTab ? null : readProjectWorkspaceTabPreference(projectId);
  const preferredTab = explicitTab ?? rememberedTab ?? defaultWorkspaceTab;

  useEffect(() => {
    setActiveTabState(preferredTab);
  }, [preferredTab]);

  useEffect(() => {
    if (explicitTab) {
      return;
    }
    const href = buildWorkspaceTabHref(pathname, searchParams, activeTab, {
      forceExplicit: shouldForceExplicitTab,
    });
    const currentQuery = searchParams.toString();
    const currentHref = currentQuery ? `${pathname}?${currentQuery}` : pathname;
    if (href === currentHref) {
      return;
    }
    router.replace(href, { scroll: false });
  }, [activeTab, explicitTab, pathname, router, searchParams, shouldForceExplicitTab]);

  const setActiveTab = useCallback((tab: WorkspaceTab) => {
    setActiveTabState(tab);
    writeProjectWorkspaceTabPreference(projectId, tab);
    router.replace(
      buildWorkspaceTabHref(pathname, searchParams, tab, {
        forceExplicit: shouldForceExplicitTab,
      }),
      { scroll: false },
    );
  }, [pathname, projectId, router, searchParams, shouldForceExplicitTab]);

  const project = snapshotQuery.data?.project;
  const progress = progressQuery.data;
  const storyContract = snapshotQuery.data?.storyContract;
  const effectiveNarrativePerson = narrativePersonDraft ?? project?.narrativePerson ?? "third";
  const unitLabel = project ? getProjectUnitLabel(project) : "章节";
  const structureSummary = project ? buildProjectStructureSummary(project) : "";
  const manuscriptMaxChapter = project
    ? project.chapterPlanningMode === "dynamic"
      ? Math.max(1, ...(snapshotQuery.data?.writtenChapters ?? []), progress?.currentChapter ?? 1)
      : Math.max(project.targetChapters, ...(snapshotQuery.data?.writtenChapters ?? []), progress?.currentChapter ?? 1)
    : 1;
  const deleteStartChapter = project
    ? Math.min(Math.max(deleteRange.startChapter || (progress?.currentChapter ?? 1), 1), manuscriptMaxChapter)
    : 1;
  const deleteEndChapter = project
    ? Math.min(Math.max(deleteRange.endChapter || manuscriptMaxChapter, deleteStartChapter), manuscriptMaxChapter)
    : deleteStartChapter;
  const defaultReviewPolicy = useMemo(() => {
    const policy = snapshotQuery.data?.resolvedReviewPolicy;
    return {
      cadenceChapters: policy?.cadenceChapters ?? 100,
      deepReviewStartChapter: policy?.deepReviewStartChapter ?? 100,
      manualCheckpointChapters: (policy?.manualCheckpointChapters ?? []).join(", "),
    };
  }, [snapshotQuery.data?.resolvedReviewPolicy]);
  const effectiveReviewPolicy = reviewPolicyDraft
    ? {
        cadenceChapters: Math.max(1, Math.trunc(reviewPolicyDraft.cadenceChapters || defaultReviewPolicy.cadenceChapters)),
        deepReviewStartChapter: Math.max(
          1,
          Math.trunc(reviewPolicyDraft.deepReviewStartChapter || defaultReviewPolicy.deepReviewStartChapter),
        ),
        manualCheckpointChapters: reviewPolicyDraft.manualCheckpointChapters
          .split(/[\s,，]+/)
          .map((item) => Number(item))
          .filter((value) => Number.isFinite(value) && value > 0),
      }
    : {
        cadenceChapters: defaultReviewPolicy.cadenceChapters,
        deepReviewStartChapter: defaultReviewPolicy.deepReviewStartChapter,
        manualCheckpointChapters: defaultReviewPolicy.manualCheckpointChapters
          .split(/[\s,，]+/)
          .map((item) => Number(item))
          .filter((value) => Number.isFinite(value) && value > 0),
      };
  const isRunning = progress?.running ?? false;
  const isStopping = progress?.desiredState === "stopped" && isRunning;
  const isRecoverable = Boolean(progress?.recoverable) || progress?.stage === "paused" || progress?.stage === "interrupted";
  const isStopped = progress?.desiredState === "stopped" && !isRunning && !isRecoverable;
  const isPaused = progress?.stage === "paused";
  const isInterrupted = progress?.stage === "interrupted";
  const isAwaitingManualReview = progress?.stage === "manual_review";
  const isCompleted = progress?.stage === "completed";
  const coreDrift = Boolean(snapshotQuery.data?.coreDrift);
  const blockingReason = snapshotQuery.data?.blockingReason ?? null;
  const displayStatus = isStopping
    ? "stopping"
    : isStopped
      ? "stopped"
      : progress?.stage && progress.stage !== "idle"
        ? progress.stage
        : project?.status ?? "idle";
  const canStartRun =
    Boolean(snapshotQuery.data?.foundationLocked)
    && !coreDrift
    && !simpleMutation.isPending
    && !isRunning
    && !isAwaitingManualReview
    && !isCompleted;
  const latestLogs = (progress?.logs ?? snapshotQuery.data?.logs ?? []).slice(-6).reverse();
  const activeSteeringNotes = (snapshotQuery.data?.steeringNotes ?? []).filter((note) => note.active);
  const invalidatedHistory = snapshotQuery.data?.invalidatedHistory ?? [];
  const activeVolumeNo = progress?.currentVolume ?? storyContract?.currentVolume ?? 1;
  const currentChapterNo = progress?.currentChapter ?? 1;
  const currentVolume = storyContract?.volumes.find((volume) => volume.volumeNo === activeVolumeNo);
  const currentMilestone = getCurrentMilestone(storyContract ?? null, activeVolumeNo, currentChapterNo);
  const hasMissingMilestones = Boolean(storyContract?.volumes.some((volume) => !(volume.milestones?.length)));
  const completionPercent = Math.round((progress?.completionProgress ?? storyContract?.forecast.completionProgress ?? 0) * 100);
  const runStatisticsSummary = snapshotQuery.data?.runStatisticsSummary ?? {
    windowSize: 20,
    sampleCount: 0,
    repairRate: 0,
    fallbackRate: 0,
    hardConflictRate: 0,
    medianVerificationScore: null,
    recommendation: "data_insufficient" as const,
  };
  const blueprintHealthRecommendationLabel = {
    data_insufficient: "样本不足，继续观察",
    keep_3: "建议继续保持 3 候选",
    observe: "先观察，不建议贸然切到 2 候选",
    safe_to_try_2: "质量稳定，可考虑试验 2 候选",
  }[runStatisticsSummary.recommendation];
  const blueprintHealthSummaryText = `repair ${Math.round(runStatisticsSummary.repairRate * 100)}% · fallback ${Math.round(runStatisticsSummary.fallbackRate * 100)}% · hard conflict ${Math.round(runStatisticsSummary.hardConflictRate * 100)}%`;
  const blueprintHealthScoreText = runStatisticsSummary.medianVerificationScore === null
    ? "verification 中位数：暂无"
    : `verification 中位数：${runStatisticsSummary.medianVerificationScore}`;
  const controlStateLabel = progress?.desiredState ? {
    idle: "空闲",
    running: "运行中",
    paused: "已暂停",
    stopped: "已停止",
  }[progress.desiredState] : "空闲";
  const lastActiveStageLabelMap = {
    blueprint: "蓝图",
    context: "上下文",
    writing: "写作",
    style_pass: "润色",
    planning_repair: "规划回修",
    review: "审核",
    analysis: "分析",
  } as const;
  const lastActiveStageLabel = progress?.lastActiveStage
    ? lastActiveStageLabelMap[progress.lastActiveStage] ?? "暂无"
    : "暂无";
  const heartbeatLabel = progress?.heartbeatAt
    ? `${new Date(progress.heartbeatAt).toLocaleString("zh-CN")}${
      typeof progress.heartbeatAgeMs === "number"
        ? `（${Math.max(0, Math.round(progress.heartbeatAgeMs / 1000))} 秒前）`
        : ""
    }`
    : "暂无";
  const forecastLabel = progress?.forecastRange
    ? `${progress.forecastRange.min}-${progress.forecastRange.max} 章（目标 ${progress.forecastRange.target}）`
    : project
      ? project.chapterPlanningMode === "fixed"
        ? `固定 ${project.targetChapters} 章`
        : `${project.chapterBudgetMin}-${project.chapterBudgetMax} 章`
      : "待生成";
  const hasWrittenChapters = (snapshotQuery.data?.writtenChapters.length ?? 0) > 0;
  const units = useMemo(() => {
    if (!project) {
      return [];
    }
    const segmentItemsByChapter = new Map(
      (storyContract?.segmentPlans ?? []).flatMap((segment) =>
        segment.items.map((item) => [
          item.chapterNo,
          {
            title: item.narrativeTitle?.trim() || item.title,
            intent: item.narrativeIntent?.trim() || item.intent,
            rewriteStatus: item.rewriteStatus ?? "pending",
          },
        ] as const),
      ),
    );
    const writtenChapters = new Set(snapshotQuery.data?.writtenChapters ?? []);
    const conflicts = snapshotQuery.data?.conflicts ?? [];
    const currentChapter = progress?.currentChapter ?? 1;
    const reviewStates = new Map(
      (snapshotQuery.data?.reviewStates ?? []).map((item) => [item.chapterNo, item.status] as const),
    );

    return Array.from({ length: manuscriptMaxChapter }, (_, index) => {
      const chapterNo = index + 1;
      return {
        chapterNo,
        hasContent: writtenChapters.has(chapterNo),
        hasConflict: conflicts.some((item) => item.chapterNo === chapterNo),
        isCurrent: currentChapter === chapterNo,
        reviewStatus: reviewStates.get(chapterNo) ?? null,
        segmentTitle: segmentItemsByChapter.get(chapterNo)?.title ?? null,
        segmentIntent: segmentItemsByChapter.get(chapterNo)?.intent ?? null,
        rewriteStatus: segmentItemsByChapter.get(chapterNo)?.rewriteStatus ?? "pending",
      };
    });
  }, [manuscriptMaxChapter, progress?.currentChapter, project, snapshotQuery.data?.conflicts, snapshotQuery.data?.reviewStates, snapshotQuery.data?.writtenChapters, storyContract?.segmentPlans]);
  const nextHint = !snapshotQuery.data?.foundationLocked
    ? "先把正式设定锁定，再进入正文写作。"
    : coreDrift && blockingReason
      ? blockingReason
    : isStopping
      ? "停止请求已发出，系统正在等待当前步骤收束。"
      : progress?.recoverable && progress?.desiredState === "stopped"
        ? `停止请求已收束。点击恢复写作后，系统会从第 ${currentChapterNo} 个${unitLabel}继续。`
        : isStopped
          ? `写作已停止。重新启动后，系统会从第 ${currentChapterNo} 个${unitLabel}重新开跑。`
          : isPaused
            ? `写作已暂停。点击恢复写作后，系统会从第 ${currentChapterNo} 个${unitLabel}继续。`
            : isInterrupted
              ? "上一次运行异常中断了。重新点击开始写作后，系统会从当前章节续写。"
              : isRunning
                ? "自动写作进行中，系统会在后台按剧情段规划并持续审核。"
                : `下一步可以从第 ${currentChapterNo} 个${unitLabel}继续写，系统会自动规划接下来的剧情段。`;
  const tabs = [
    { key: "chat" as const, label: "设定工坊", icon: <MessageSquareDashed className="h-4 w-4" /> },
    { key: "characterBook" as const, label: "角色书", icon: <UserRound className="h-4 w-4" /> },
    { key: "worldBook" as const, label: "世界书", icon: <Globe2 className="h-4 w-4" /> },
    { key: "outline" as const, label: "章节结构", icon: <BookOpenText className="h-4 w-4" /> },
    { key: "authorSubmissions" as const, label: "作者稿", icon: <FilePenLine className="h-4 w-4" /> },
    { key: "models" as const, label: "模型分配", icon: <Bot className="h-4 w-4" /> },
  ];
  const activeTabLabel = tabs.find((tab) => tab.key === activeTab)?.label ?? "设定工坊";

  const triggerPrimaryRun = () =>
    simpleMutation.mutate(
      isRecoverable
        ? {
            url: `/api/projects/${projectId}/run/resume`,
            success: "写作已恢复",
          }
        : {
            url: `/api/projects/${projectId}/run/start`,
            body: { fromChapter: currentChapterNo },
            success: isInterrupted || isStopped ? "写作已恢复" : "写作已启动",
          },
    );
  const triggerMilestoneGeneration = () =>
    simpleMutation.mutate({
      url: `/api/projects/${projectId}/story-contract/milestones/generate`,
      success: "卷级里程碑已补齐",
    });

  const projectHeaderProps = {
    activeTabLabel,
    projectGenre: project?.genre ?? "载入中",
    narrativePersonLabel: project ? getNarrativePersonLabel(project.narrativePerson) : "第三人称",
    unitLabel,
    displayStatus,
    tabs,
    activeTab,
    onTabChange: setActiveTab,
    onToggleRightPanel: () => setShowRightPanel(!showRightPanel),
  };

  const chapterListProps = {
    projectId,
    projectStoryLength: project?.storyLength ?? "long",
    units,
    isRunning,
  };

  const runControlProps = {
    projectId,
    activeTabLabel,
    project,
    progress,
    currentVolumeLabel: currentVolume?.label ?? "未进入分卷",
    forecastLabel,
    completionPercent,
    runStatisticsSummary,
    blueprintHealthRecommendationLabel,
    blueprintHealthSummaryText,
    blueprintHealthScoreText,
    activeSteeringNotes,
    invalidatedHistory,
    latestLogs,
    cardStats: {
      total: cardsQuery.data?.cards.length ?? 0,
      confirmed: (cardsQuery.data?.cards ?? []).filter((card) => card.status === "confirmed").length,
      character: (cardsQuery.data?.cards ?? []).filter((card) => card.cardType === "character").length,
      world: (cardsQuery.data?.cards ?? []).filter((card) => card.cardType === "world").length,
    },
    foundationStatusLabel: snapshotQuery.data?.foundationLocked ? "已锁定" : snapshotQuery.data?.foundation ? "已整理" : "整理中",
    coreDrift,
    blockingReason,
    conflictCount: snapshotQuery.data?.conflicts.length ?? 0,
    controlStateLabel,
    lastActiveStageLabel,
    heartbeatLabel,
    canStartRun,
    isRunning,
    isStopping,
    isStopped,
    isPaused,
    isInterrupted,
    isCompleted,
    hasWrittenChapters,
    nextHint,
    manuscriptMaxChapter,
    deleteStartChapter,
    deleteEndChapter,
    simpleMutationPending: simpleMutation.isPending,
    steeringScope,
    steeringInstruction,
    effectiveNarrativePerson,
    saveNarrativePersonPending: saveNarrativePersonMutation.isPending,
    steeringPending: steeringMutation.isPending,
    novelExport: snapshotQuery.data?.novelExport,
    onClose: () => setShowRightPanel(false),
    onTriggerPrimaryRun: triggerPrimaryRun,
    onPauseRun: () =>
      simpleMutation.mutate({
        url: `/api/projects/${projectId}/run/pause`,
        success: "已暂停",
      }),
    onStopRun: () =>
      simpleMutation.mutate({
        url: `/api/projects/${projectId}/run/stop`,
        success: "停止请求已发送",
      }),
    onDeleteStartChange: (value: number) => setDeleteRange((current) => ({ ...current, startChapter: value })),
    onDeleteEndChange: (value: number) => setDeleteRange((current) => ({ ...current, endChapter: value })),
    onDeleteRange: async () => {
      const startChapter = deleteStartChapter;
      const endChapter = deleteEndChapter;
      const label = startChapter === endChapter ? `第 ${startChapter} 章` : `第 ${startChapter} 章到第 ${endChapter} 章`;
      const confirmed = await confirm({
        title: `删除${label}`,
        description: `即将删除${label}的正文、内部规划和审核产物。写作位置会退回到起始章节。此操作不可撤销。`,
        confirmLabel: "确认删除",
        variant: "danger",
      });
      if (confirmed) {
        simpleMutation.mutate({
          url: `/api/projects/${projectId}/chapters/delete-range`,
          body: { startChapter, endChapter },
          success: `${label}已删除，写作位置已回退`,
        });
      }
    },
    onSteeringScopeChange: setSteeringScope,
    onSteeringInstructionChange: setSteeringInstruction,
    onSaveSteering: () => steeringMutation.mutate({ instruction: steeringInstruction.trim(), scope: steeringScope }),
    onNarrativePersonChange: setNarrativePersonDraft,
    onSaveNarrativePerson: () => saveNarrativePersonMutation.mutate(effectiveNarrativePerson),
    onResetToFoundationWorkshop: async () => {
      const confirmed = await confirm({
        title: "重置到设定工坊",
        description:
          "此操作会只保留你和 AI 的设定对话记录，其余正文、正式设定、角色书、世界书、文风草稿、模型分配、审核和导出结果都会被永久清空。此操作不可撤销。",
        confirmLabel: "确认重置",
        variant: "danger",
      });
      if (confirmed) {
        simpleMutation.mutate({
          url: `/api/projects/${projectId}/foundation/reset`,
          success: "已重置到设定工坊",
          invalidateFoundationWorkshop: true,
          afterSuccess: () => {
            setActiveTab("chat");
          },
        });
      }
    },
    onDeleteProject: async () => {
      const confirmed = await confirm({
        title: "删除此项目",
        description:
          "项目将被移入回收站。你可以在回收站中恢复，也可以永久删除。",
        confirmLabel: "移入回收站",
        variant: "warning",
      });
      if (confirmed) {
        simpleMutation.mutate({
          url: `/api/projects/${projectId}/trash`,
          success: "项目已移入回收站",
          redirectTo: "/projects",
        });
      }
    },
  };

  const effectiveAssignments = !profilesQuery.data?.profiles.length
    ? ([] as RoleAssignmentValue[])
    : assignmentsDraft?.length
      ? normalizeAssignments(assignmentsDraft, profilesQuery.data.profiles)
      : normalizeAssignments(
          (snapshotQuery.data?.assignments as RoleAssignmentValue[] | undefined) ?? [],
          profilesQuery.data.profiles,
        );

  return {
    snapshotQuery,
    progressQuery,
    profilesQuery,
    cardsQuery,
    simpleMutation,
    saveAssignmentsMutation,
    saveReviewPolicyMutation,
    saveNarrativePersonMutation,
    steeringMutation,
    activeTab,
    setActiveTab,
    showRightPanel,
    setShowRightPanel,
    project,
    progress,
    storyContract,
    effectiveNarrativePerson,
    unitLabel,
    structureSummary,
    manuscriptMaxChapter,
    deleteStartChapter,
    deleteEndChapter,
    defaultReviewPolicy,
    effectiveReviewPolicy,
    isRunning,
    isStopping,
    isStopped,
    isPaused,
    isInterrupted,
    isAwaitingManualReview,
    isCompleted,
    displayStatus,
    canStartRun,
    latestLogs,
    activeSteeringNotes,
    invalidatedHistory,
    currentVolume,
    currentMilestone,
    hasMissingMilestones,
    completionPercent,
    runStatisticsSummary,
    blueprintHealthRecommendationLabel,
    blueprintHealthSummaryText,
    blueprintHealthScoreText,
    currentChapterNo,
    controlStateLabel,
    lastActiveStageLabel,
    heartbeatLabel,
    forecastLabel,
    hasWrittenChapters,
    units,
    nextHint,
    tabs,
    activeTabLabel,
    triggerPrimaryRun,
    triggerMilestoneGeneration,
    generateMilestonesPending: simpleMutation.isPending,
    effectiveAssignments,
    reviewPolicyDraft,
    setReviewPolicyDraft,
    projectHeaderProps,
    chapterListProps,
    runControlProps,
    assignmentsDraft,
    setAssignmentsDraft,
    steeringInstruction,
    steeringScope,
    setSteeringInstruction,
    setSteeringScope,
    narrativePersonDraft,
    setNarrativePersonDraft,
  };
}
