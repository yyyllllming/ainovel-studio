"use client";

import type {
  ChapterPlanningMode,
  NarrativePerson,
  PaceProfile,
  SeriesMode,
  StoryLength,
} from "@/lib/project-structure";
import { RoleAssignmentEditor, type RoleAssignmentValue } from "../role-assignment-editor";

interface IdeaDevelopmentProps {
  showCreateProject: boolean;
  titleValue: string;
  onTitleChange: (value: string) => void;
  genre: string;
  onGenreChange: (value: string) => void;
  seriesMode: SeriesMode;
  onSeriesModeChange: (value: SeriesMode) => void;
  seriesTitle: string;
  onSeriesTitleChange: (value: string) => void;
  seriesIndex: number;
  onSeriesIndexChange: (value: number) => void;
  storyLength: StoryLength;
  onStoryLengthChange: (value: StoryLength) => void;
  narrativePerson: NarrativePerson;
  onNarrativePersonChange: (value: NarrativePerson) => void;
  chapterPlanningMode: ChapterPlanningMode;
  onChapterPlanningModeChange: (value: ChapterPlanningMode) => void;
  plannedVolumes: number;
  onPlannedVolumesChange: (value: number) => void;
  paceProfile: PaceProfile;
  onPaceProfileChange: (value: PaceProfile) => void;
  targetChapters: number;
  onTargetChaptersChange: (value: number) => void;
  hardChapterCap: number;
  onHardChapterCapChange: (value: number) => void;
  completionCriteria: string;
  onCompletionCriteriaChange: (value: string) => void;
  profiles: Array<{ id: string; name: string; defaultModel: string; baseUrl?: string }>;
  assignments: RoleAssignmentValue[];
  onAssignmentsChange: (next: RoleAssignmentValue[]) => void;
  createProjectPending: boolean;
  onCreateProject: () => void;
}

const presetGenres = [
  "现代悬疑",
  "古代言情",
  "都市异能",
  "玄幻修仙",
  "科幻未来",
  "历史军事",
  "职场商战",
];

export function IdeaDevelopment({
  showCreateProject,
  titleValue,
  onTitleChange,
  genre,
  onGenreChange,
  seriesMode,
  onSeriesModeChange,
  seriesTitle,
  onSeriesTitleChange,
  seriesIndex,
  onSeriesIndexChange,
  storyLength,
  onStoryLengthChange,
  narrativePerson,
  onNarrativePersonChange,
  chapterPlanningMode,
  onChapterPlanningModeChange,
  plannedVolumes,
  onPlannedVolumesChange,
  paceProfile,
  onPaceProfileChange,
  targetChapters,
  onTargetChaptersChange,
  hardChapterCap,
  onHardChapterCapChange,
  completionCriteria,
  onCompletionCriteriaChange,
  profiles,
  assignments,
  onAssignmentsChange,
  createProjectPending,
  onCreateProject,
}: IdeaDevelopmentProps) {
  if (!showCreateProject) {
    return null;
  }

  return (
    <section className="workspace-panel p-6">
      <div className="mb-5">
        <p className="section-title">Create Project</p>
        <h2 className="mt-1 text-2xl font-semibold [font-family:var(--font-serif)]">从想法创建项目</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">
          想法内容会原样保留；项目只拿一份快照，进去后就直接进入作者文风与正式设定流程。
        </p>
      </div>

      <div className="grid gap-5">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="form-label">项目标题 *</label>
            <input className="form-input" value={titleValue} onChange={(event) => onTitleChange(event.target.value)} />
          </div>
          <div>
            <label className="form-label">题材 *</label>
            <input
              className="form-input"
              value={genre}
              onChange={(event) => onGenreChange(event.target.value)}
              list="idea-genre-options"
              placeholder="例如：玄幻修仙"
            />
            <datalist id="idea-genre-options">
              {presetGenres.map((item) => <option key={item} value={item} />)}
            </datalist>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <label className="form-label">系列归属</label>
            <select
              className="form-input"
              value={seriesMode}
              onChange={(event) => onSeriesModeChange(event.target.value as SeriesMode)}
            >
              <option value="standalone">单作</option>
              <option value="series">系列作品</option>
            </select>
          </div>
          <div>
            <label className="form-label">体量</label>
            <select
              className="form-input"
              value={storyLength}
              onChange={(event) => onStoryLengthChange(event.target.value as StoryLength)}
            >
              <option value="medium">中篇</option>
              <option value="long">长篇</option>
              <option value="short">短篇</option>
            </select>
          </div>
          <div>
            <label className="form-label">叙事人称</label>
            <select
              className="form-input"
              value={narrativePerson}
              onChange={(event) => onNarrativePersonChange(event.target.value as NarrativePerson)}
            >
              <option value="third">第三人称</option>
              <option value="first">第一人称</option>
            </select>
          </div>
          {storyLength !== "short" ? (
            <div>
              <label className="form-label">节奏</label>
              <select
                className="form-input"
                value={paceProfile}
                onChange={(event) => onPaceProfileChange(event.target.value as PaceProfile)}
              >
                <option value="fast">快</option>
                <option value="medium">中</option>
                <option value="slow">慢</option>
              </select>
            </div>
          ) : null}
        </div>

        {seriesMode === "series" ? (
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="form-label">系列名称</label>
              <input className="form-input" value={seriesTitle} onChange={(event) => onSeriesTitleChange(event.target.value)} />
            </div>
            <div>
              <label className="form-label">系列序号</label>
              <input
                type="number"
                className="form-input"
                value={seriesIndex}
                min={1}
                max={999}
                onChange={(event) => onSeriesIndexChange(Number(event.target.value) || 1)}
              />
            </div>
          </div>
        ) : null}

        {storyLength !== "short" ? (
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="form-label">规划模式</label>
              <select
                className="form-input"
                value={chapterPlanningMode}
                onChange={(event) => onChapterPlanningModeChange(event.target.value as ChapterPlanningMode)}
              >
                <option value="dynamic">动态估算</option>
                <option value="fixed">固定章节</option>
              </select>
            </div>
            <div>
              <label className="form-label">计划卷数</label>
              <input
                type="number"
                className="form-input"
                value={plannedVolumes}
                min={1}
                max={24}
                onChange={(event) => onPlannedVolumesChange(Number(event.target.value) || 1)}
              />
            </div>
            {chapterPlanningMode === "fixed" ? (
              <div>
                <label className="form-label">固定章节数</label>
                <input
                  type="number"
                  className="form-input"
                  value={targetChapters}
                  min={1}
                  max={200}
                  onChange={(event) => onTargetChaptersChange(Number(event.target.value) || 1)}
                />
              </div>
            ) : (
              <div>
                <label className="form-label">最大章节上限</label>
                <input
                  type="number"
                  className="form-input"
                  value={hardChapterCap}
                  min={1}
                  max={200}
                  onChange={(event) => onHardChapterCapChange(Number(event.target.value) || 1)}
                />
              </div>
            )}
          </div>
        ) : null}

        <div>
          <label className="form-label">完结标准</label>
          <textarea
            className="form-input min-h-[96px] resize-none"
            value={completionCriteria}
            onChange={(event) => onCompletionCriteriaChange(event.target.value)}
          />
        </div>

        {profiles.length ? (
          <div>
            <label className="form-label">角色模型分配</label>
            <div className="mt-1">
              <RoleAssignmentEditor
                profiles={profiles}
                assignments={assignments}
                onChange={onAssignmentsChange}
              />
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-muted)] px-4 py-3 text-sm text-[var(--ink-soft)]">
            尚未配置模型 Profile，请先去“模型配置”补一个，再回来开项目。
          </div>
        )}

        <button
          className="btn-primary w-full justify-center"
          disabled={
            !titleValue.trim()
            || !genre.trim()
            || !profiles.length
            || createProjectPending
            || (seriesMode === "series" && !seriesTitle.trim())
          }
          onClick={onCreateProject}
        >
          {createProjectPending ? "创建中…" : "从这份想法创建项目"}
        </button>
      </div>
    </section>
  );
}
