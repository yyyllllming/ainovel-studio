"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getEffectivePublicLlmProfileId, getUsablePublicLlmProfiles } from "@/lib/llm-profile";
import { buildNewProjectWorkspaceHref } from "@/lib/project-navigation";
import { useIdeaQueries } from "./idea/use-idea-queries";
import { IdeaCocreation } from "./idea/idea-cocreation";
import { IdeaDevelopment } from "./idea/idea-development";
import { IdeaHeader } from "./idea/idea-header";
import { IdeaInsightsSidebar } from "./idea/idea-insights-sidebar";
import { useIdeaWorkshopController } from "./idea/use-idea-workshop-controller";
import {
  type ChapterPlanningMode,
  type NarrativePerson,
  type PaceProfile,
  type SeriesMode,
  type StoryLength,
} from "@/lib/project-structure";
import {
  createDefaultAssignments,
  normalizeAssignments,
  type RoleAssignmentValue,
} from "./role-assignment-editor";

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
  const budgetPresets: Record<Exclude<StoryLength, "short">, Record<PaceProfile, { target: number; max: number }>> = {
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
  const preset = budgetPresets[storyLength][paceProfile];
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

export function IdeaDetailClient({
  ideaId,
  initialIdea,
}: {
  ideaId: string;
  initialIdea?: Parameters<typeof useIdeaQueries>[1];
}) {
  const router = useRouter();
  const [titleDraft, setTitleDraft] = useState("");
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [genre, setGenre] = useState("");
  const [seriesMode, setSeriesMode] = useState<SeriesMode>("standalone");
  const [seriesTitle, setSeriesTitle] = useState("");
  const [seriesIndex, setSeriesIndex] = useState(1);
  const [storyLength, setStoryLength] = useState<StoryLength>("long");
  const [narrativePerson, setNarrativePerson] = useState<NarrativePerson>("third");
  const [chapterPlanningMode, setChapterPlanningMode] = useState<ChapterPlanningMode>("dynamic");
  const [plannedVolumes, setPlannedVolumes] = useState(2);
  const [paceProfile, setPaceProfile] = useState<PaceProfile>("medium");
  const [targetChapters, setTargetChapters] = useState(16);
  const [hardChapterCap, setHardChapterCap] = useState(28);
  const [completionCriteria, setCompletionCriteria] = useState(() => getDefaultCompletionCriteria("long"));
  const [assignmentsDraft, setAssignmentsDraft] = useState<RoleAssignmentValue[] | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState("");

  const {
    ideaQuery,
    profilesQuery,
    saveTitleMutation,
    sendMutation,
    trashMutation,
    createProjectMutation,
  } = useIdeaQueries(ideaId, initialIdea);

  const idea = ideaQuery.data?.idea;
  const draft = ideaQuery.data?.state?.draft ?? null;
  const projects = ideaQuery.data?.projects.filter((project) => !project.deletedAt) ?? [];
  const titleValue = titleDraft || idea?.title || "";
  const updatedAtLabel = ideaQuery.data?.state?.updatedAt ?? idea?.updatedAt ?? null;
  const usableProfiles = useMemo(
    () => getUsablePublicLlmProfiles(profilesQuery.data?.profiles ?? []),
    [profilesQuery.data?.profiles],
  );
  const effectiveProfileId = useMemo(() => {
    return getEffectivePublicLlmProfileId(selectedProfileId, usableProfiles);
  }, [selectedProfileId, usableProfiles]);
  const workshopController = useIdeaWorkshopController({
    messages: ideaQuery.data?.messages ?? [],
    baseUpdatedAt: ideaQuery.data?.state?.updatedAt,
    effectiveProfileId,
    canSubmit: Boolean(effectiveProfileId),
    sendMutation,
  });

  const assignments = !profilesQuery.data?.profiles.length
    ? ([] as RoleAssignmentValue[])
    : !assignmentsDraft?.length
      ? createDefaultAssignments(profilesQuery.data.profiles)
      : normalizeAssignments(assignmentsDraft, profilesQuery.data.profiles);

  const effectivePlanningMode: ChapterPlanningMode = storyLength === "short" ? "fixed" : chapterPlanningMode;
  const hasVolumes = storyLength !== "short" && plannedVolumes > 1;

  return (
    <div className="min-h-screen w-full px-6 py-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <IdeaHeader
          ideaTitle={idea?.title ?? "载入中"}
          titleValue={titleValue}
          onTitleChange={setTitleDraft}
          saveTitleDisabled={!titleValue.trim() || titleValue.trim() === idea?.title}
          saveTitlePending={saveTitleMutation.isPending}
          onSaveTitle={() => saveTitleMutation.mutate(titleValue.trim())}
          showCreateProject={showCreateProject}
          onToggleCreateProject={() => setShowCreateProject((current) => !current)}
          trashPending={trashMutation.isPending}
          onTrash={() => trashMutation.mutate(true, { onSuccess: (_, deleted) => deleted && router.push("/") })}
          projectsCount={projects.length}
          usableProfiles={usableProfiles}
          selectedProfileId={effectiveProfileId}
          profilesLoading={profilesQuery.isLoading}
          onProfileChange={setSelectedProfileId}
        />

        <IdeaDevelopment
          showCreateProject={showCreateProject}
          titleValue={titleValue}
          onTitleChange={setTitleDraft}
          genre={genre}
          onGenreChange={setGenre}
          seriesMode={seriesMode}
          onSeriesModeChange={setSeriesMode}
          seriesTitle={seriesTitle}
          onSeriesTitleChange={setSeriesTitle}
          seriesIndex={seriesIndex}
          onSeriesIndexChange={setSeriesIndex}
          storyLength={storyLength}
          onStoryLengthChange={(next) => {
            setStoryLength(next);
            if (next === "short") {
              setChapterPlanningMode("fixed");
              setPlannedVolumes(1);
              setTargetChapters(1);
              setHardChapterCap(1);
            } else {
              setTargetChapters(getFixedDefaultTarget(next, plannedVolumes));
              setHardChapterCap(getDynamicPreset(next, paceProfile, plannedVolumes).hardChapterCap);
            }
            setCompletionCriteria(getDefaultCompletionCriteria(next));
          }}
          narrativePerson={narrativePerson}
          onNarrativePersonChange={setNarrativePerson}
          chapterPlanningMode={effectivePlanningMode}
          onChapterPlanningModeChange={setChapterPlanningMode}
          plannedVolumes={plannedVolumes}
          onPlannedVolumesChange={setPlannedVolumes}
          paceProfile={paceProfile}
          onPaceProfileChange={setPaceProfile}
          targetChapters={targetChapters}
          onTargetChaptersChange={setTargetChapters}
          hardChapterCap={hardChapterCap}
          onHardChapterCapChange={setHardChapterCap}
          completionCriteria={completionCriteria}
          onCompletionCriteriaChange={setCompletionCriteria}
          profiles={profilesQuery.data?.profiles ?? []}
          assignments={assignments}
          onAssignmentsChange={setAssignmentsDraft}
          createProjectPending={createProjectMutation.isPending}
          onCreateProject={() =>
            createProjectMutation.mutate(
              {
                title: titleValue.trim() || ideaQuery.data?.idea.title || "未命名项目",
                genre,
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
                assignments,
              },
              {
                onSuccess: ({ project }) => router.push(buildNewProjectWorkspaceHref(project.id)),
              },
            )}
        />

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_340px]">
          <IdeaCocreation
            messages={workshopController.displayedMessages}
            message={workshopController.message}
            sendPending={sendMutation.isPending || workshopController.isStreaming}
            updatedAtLabel={updatedAtLabel}
            canSubmit={Boolean(effectiveProfileId)}
            onMessageChange={workshopController.setMessage}
            onSubmit={workshopController.handleSubmit}
          />

          <IdeaInsightsSidebar draft={draft} projects={projects} />
        </div>
      </div>
    </div>
  );
}
