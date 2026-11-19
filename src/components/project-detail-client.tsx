"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRef } from "react";
import { ArrowLeft } from "lucide-react";
import { usePopReveal } from "./use-pop-reveal";
import { StatusBadge } from "./status-badge";
import { LoadingSkeleton } from "./loading-skeleton";
import { ChapterOutlineGrid } from "./project/chapter-outline-grid";
import { ModelAssignmentSection } from "./project/model-assignment-section";
import { ProjectHeader } from "./project/project-header";
import { ProjectChapterList } from "./project/project-chapter-list";
import { ProjectRunControl } from "./project/project-run-control";
import { useProjectDetailController } from "./project/use-project-detail-controller";

const CardLibraryClient = dynamic(
  () => import("./card-library-client.tsx").then((mod) => mod.CardLibraryClient),
  { loading: () => <LoadingSkeleton variant="card" /> },
);

const FoundationWorkshopClient = dynamic(
  () => import("./foundation-workshop-client.tsx").then((mod) => mod.FoundationWorkshopClient),
  { loading: () => <LoadingSkeleton variant="text" /> },
);

const AuthorSubmissionsClient = dynamic(
  () => import("./author-submissions-client.tsx").then((mod) => mod.AuthorSubmissionsClient),
  { loading: () => <LoadingSkeleton variant="card" /> },
);

export function ProjectDetailClient({
  projectId,
  initialSnapshot,
  initialProgress,
  initialProfiles,
  initialCards,
}: {
  projectId: string;
  initialSnapshot?: import("@/lib/types").ProjectDetail | null;
  initialProgress?: import("@/lib/types").ProjectRunProgress | null;
  initialProfiles?: { profiles: import("@/lib/types").LlmProfile[] };
  initialCards?: { cards: import("@/lib/types").ProjectCardSummary[]; candidateCount?: number };
}) {
  const controller = useProjectDetailController({
    projectId,
    initialSnapshot,
    initialProgress,
    initialProfiles,
    initialCards,
  });

  const revealScope = useRef<HTMLDivElement>(null);
  usePopReveal(revealScope);

  function renderMainPane() {
    if (controller.activeTab === "characterBook" || controller.activeTab === "worldBook") {
      const defaultTab = controller.activeTab === "characterBook" ? "character" : "world";
      return (
        <CardLibraryClient
          key="card-library"
          projectId={projectId}
          defaultTab={defaultTab}
        />
      );
    }

    if (controller.activeTab === "outline" && controller.project) {
      return (
        <ChapterOutlineGrid
          projectId={projectId}
          storyLength={controller.project.storyLength}
          chapterPlanningMode={controller.project.chapterPlanningMode}
          hardChapterCap={controller.progress?.hardChapterCap ?? controller.project.hardChapterCap ?? 1}
          unitLabel={controller.unitLabel}
          currentChapterNo={controller.currentChapterNo}
          currentVolumeLabel={controller.currentVolume?.label ?? (controller.project.storyLength === "short" ? "短篇单元" : "待规划")}
          currentVolumeGoal={controller.currentVolume?.goal ?? controller.storyContract?.endingPromise ?? "当前卷目标会在运行中持续修正。"}
          currentMilestoneLabel={controller.currentMilestone?.label ?? null}
          currentMilestoneGoal={controller.currentMilestone?.goal ?? null}
          needsMilestoneGeneration={controller.hasMissingMilestones}
          generatingMilestones={controller.generateMilestonesPending}
          onGenerateMilestones={controller.triggerMilestoneGeneration}
          writtenChapterCount={controller.snapshotQuery.data?.writtenChapters.length ?? 0}
          forecastLabel={controller.forecastLabel}
          completionPercent={controller.completionPercent}
          runStatisticsSummary={controller.runStatisticsSummary}
          blueprintHealthRecommendationLabel={controller.blueprintHealthRecommendationLabel}
          blueprintHealthSummaryText={controller.blueprintHealthSummaryText}
          blueprintHealthScoreText={controller.blueprintHealthScoreText}
          nextPlan={(controller.progress?.nextPlan?.length ? controller.progress.nextPlan : controller.storyContract?.recentPlan ?? [])}
          hasWrittenChapters={controller.hasWrittenChapters}
          canStartRun={controller.canStartRun}
          isCompleted={controller.isCompleted}
          isStopping={controller.isStopping}
          isStopped={controller.isStopped}
          isPaused={controller.isPaused}
          isInterrupted={controller.isInterrupted}
          isRunning={controller.isRunning}
          units={controller.units}
          onTriggerPrimaryRun={controller.triggerPrimaryRun}
        />
      );
    }

    if (controller.activeTab === "models") {
      return (
        <ModelAssignmentSection
          profiles={controller.profilesQuery.data?.profiles ?? []}
          assignments={controller.effectiveAssignments}
          onAssignmentsChange={controller.setAssignmentsDraft}
          saveAssignmentsPending={controller.saveAssignmentsMutation.isPending}
          onSaveAssignments={() => controller.saveAssignmentsMutation.mutate(controller.effectiveAssignments)}
          deepReviewStartChapter={controller.snapshotQuery.data?.resolvedReviewPolicy.deepReviewStartChapter ?? 100}
          cadenceChapters={controller.snapshotQuery.data?.resolvedReviewPolicy.cadenceChapters ?? 100}
          reviewPolicyDraft={controller.reviewPolicyDraft}
          defaultReviewPolicy={controller.defaultReviewPolicy}
          onReviewPolicyDraftChange={controller.setReviewPolicyDraft}
          saveReviewPolicyPending={controller.saveReviewPolicyMutation.isPending}
          onSaveReviewPolicy={() => controller.saveReviewPolicyMutation.mutate(controller.effectiveReviewPolicy)}
        />
      );
    }

    if (controller.activeTab === "authorSubmissions") {
      return <AuthorSubmissionsClient projectId={projectId} />;
    }

    return (
      <FoundationWorkshopClient
        projectId={projectId}
        foundation={controller.snapshotQuery.data?.foundation ?? null}
        foundationLocked={controller.snapshotQuery.data?.foundationLocked ?? false}
        sourceIdea={controller.snapshotQuery.data?.sourceIdea ?? null}
      />
    );
  }

  return (
    <div ref={revealScope} className="flex h-[calc(100vh-1rem)] w-full">
      <div className="flex w-full gap-4">
        <aside className="sticky top-6 h-full w-64 flex-shrink-0 overflow-hidden border-r border-[var(--line)] pr-4">
          <div className="flex h-full flex-col gap-4">
            <Link href="/projects" className="btn-ghost w-fit">
              <ArrowLeft className="h-4 w-4" />
              返回项目列表
            </Link>

            <div data-reveal className="workspace-item active px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="section-title">Project</p>
                  <h1 className="mt-2 truncate text-2xl font-semibold [font-family:var(--font-serif)]">
                    {controller.project?.title ?? "加载中喵…"}
                  </h1>
                </div>
                <StatusBadge status={controller.displayStatus} />
              </div>
              {controller.structureSummary ? (
                <p className="mt-3 text-sm leading-6 text-[var(--ink-soft)]">{controller.structureSummary}</p>
              ) : null}
            </div>

            <div className="nav-divider !mx-0" />

            <ProjectChapterList {...controller.chapterListProps} />
          </div>
        </aside>

        <main className="relative flex h-full min-w-0 flex-1 flex-col overflow-y-auto p-6">
          <div data-reveal className="mx-auto grid w-full max-w-5xl content-start gap-4 pb-10">
            <ProjectHeader {...controller.projectHeaderProps} />
            {renderMainPane()}
          </div>
        </main>
      </div>

      {controller.showRightPanel ? (
        <ProjectRunControl {...controller.runControlProps} />
      ) : null}
    </div>
  );
}
