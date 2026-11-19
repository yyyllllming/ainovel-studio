"use client";

import type {
  ChapterPlanningMode,
  NarrativePerson,
  PaceProfile,
  SeriesMode,
  StoryLength,
} from "@/lib/project-structure";
import type { LlmProfile } from "@/lib/types";
import { BookOpen } from "lucide-react";
import {
  RoleAssignmentEditor,
  type RoleAssignmentValue,
} from "@/components/role-assignment-editor";

interface ProjectCreationFormState {
  title: string;
  genre: string;
  seriesMode: SeriesMode;
  seriesTitle: string;
  seriesIndex: number;
  storyLength: StoryLength;
  narrativePerson: NarrativePerson;
  plannedVolumes: number;
  paceProfile: PaceProfile;
  completionCriteria: string;
  effectivePlanningMode: ChapterPlanningMode;
  targetChapters: number;
  hardChapterCap: number;
  premise: string;
  showAdvanced: boolean;
}

interface ProjectCreationFormHandlers {
  onCancel: () => void;
  onCreate: () => void;
  onTitleChange: (value: string) => void;
  onGenreChange: (value: string) => void;
  onSeriesModeChange: (value: SeriesMode) => void;
  onSeriesTitleChange: (value: string) => void;
  onSeriesIndexChange: (value: number) => void;
  onStoryLengthChange: (value: StoryLength) => void;
  onNarrativePersonChange: (value: NarrativePerson) => void;
  onPlannedVolumesChange: (value: number) => void;
  onPaceProfileChange: (value: PaceProfile) => void;
  onCompletionCriteriaChange: (value: string) => void;
  onShowAdvancedToggle: () => void;
  onPlanningModeChange: (value: ChapterPlanningMode) => void;
  onTargetChaptersChange: (value: number) => void;
  onHardChapterCapChange: (value: number) => void;
  onPremiseChange: (value: string) => void;
  onAssignmentsChange: (next: RoleAssignmentValue[]) => void;
}

interface ProjectCreationFormProps {
  presetGenres: string[];
  state: ProjectCreationFormState;
  handlers: ProjectCreationFormHandlers;
  profiles: LlmProfile[];
  assignments: RoleAssignmentValue[];
  planPreview: string;
  narrativePersonLabel: string;
  createPending: boolean;
  createDisabled: boolean;
}

export function ProjectCreationForm({
  presetGenres,
  state,
  handlers,
  profiles,
  assignments,
  planPreview,
  narrativePersonLabel,
  createPending,
  createDisabled,
}: ProjectCreationFormProps) {
  const {
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
  } = state;

  return (
    <section className="workspace-panel mx-auto max-w-4xl p-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <p className="section-title">新建</p>
          <h2 className="mt-1 text-2xl font-semibold [font-family:var(--font-serif)]">新建项目</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">
            先定义作品归属、篇幅和结构，再开始后面的设定与写作流程。
          </p>
        </div>
        <button onClick={handlers.onCancel} className="btn-ghost text-xs">取消</button>
      </div>

      <div className="grid gap-5">
        <div>
          <label className="form-label">项目标题 *</label>
          <input
            className="form-input"
            value={title}
            onChange={(event) => handlers.onTitleChange(event.target.value)}
            placeholder="给你的故事起个名字"
          />
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="form-label">题材</label>
            <input
              className="form-input"
              value={genre}
              onChange={(event) => handlers.onGenreChange(event.target.value)}
              list="project-genre-options"
              placeholder="可选预设，也可以直接自己写"
            />
            <datalist id="project-genre-options">
              {presetGenres.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="form-label">系列归属</label>
            <select
              className="form-input"
              value={seriesMode}
              onChange={(event) => handlers.onSeriesModeChange(event.target.value as SeriesMode)}
            >
              <option value="standalone">单作</option>
              <option value="series">系列作品</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {presetGenres.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => handlers.onGenreChange(item)}
              className={`workspace-pill px-3 py-1.5 text-sm ${
                genre === item ? "bg-[var(--accent)] text-[var(--accent-ink)]" : "text-[var(--ink-soft)]"
              }`}
            >
              {item}
            </button>
          ))}
        </div>

        {seriesMode === "series" ? (
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="form-label">系列名称</label>
              <input
                className="form-input"
                value={seriesTitle}
                onChange={(event) => handlers.onSeriesTitleChange(event.target.value)}
                placeholder="例如：雾港档案"
              />
            </div>
            <div>
              <label className="form-label">系列序号</label>
              <input
                type="number"
                className="form-input"
                value={seriesIndex}
                min={1}
                max={999}
                onChange={(event) => handlers.onSeriesIndexChange(Number(event.target.value))}
              />
            </div>
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <label className="form-label">体量</label>
            <select
              className="form-input"
              value={storyLength}
              onChange={(event) => handlers.onStoryLengthChange(event.target.value as StoryLength)}
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
              onChange={(event) => handlers.onNarrativePersonChange(event.target.value as NarrativePerson)}
            >
              <option value="third">第三人称</option>
              <option value="first">第一人称</option>
            </select>
            <p className="mt-2 text-xs leading-5 text-[var(--ink-soft)]">
              整部正文统一按 {narrativePersonLabel} 写，不在章节里来回漂移。
            </p>
          </div>
          {storyLength !== "short" ? (
            <div>
              <label className="form-label">计划几卷</label>
              <input
                type="number"
                className="form-input"
                value={plannedVolumes}
                min={1}
                max={24}
                onChange={(event) => handlers.onPlannedVolumesChange(Number(event.target.value))}
              />
            </div>
          ) : (
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-muted)] px-4 py-3 text-sm text-[var(--ink-soft)]">
              短篇保持单单元流程，不强制切到动态多卷规划。
            </div>
          )}
          {storyLength !== "short" ? (
            <div>
              <label className="form-label">节奏</label>
              <select
                className="form-input"
                value={paceProfile}
                onChange={(event) => handlers.onPaceProfileChange(event.target.value as PaceProfile)}
              >
                <option value="fast">快</option>
                <option value="medium">中</option>
                <option value="slow">慢</option>
              </select>
            </div>
          ) : null}
        </div>

        {storyLength !== "short" ? (
          <div className="rounded-3xl border border-[var(--line)] bg-[var(--panel-muted)] px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[var(--ink)]">动态长篇默认方案</p>
                <p className="mt-1 text-sm text-[var(--ink-soft)]">{planPreview}</p>
              </div>
              <button
                type="button"
                className="btn-ghost px-3 py-2 text-xs"
                onClick={handlers.onShowAdvancedToggle}
              >
                {showAdvanced ? "收起高级选项" : "打开高级选项"}
              </button>
            </div>
            <div className="mt-4">
              <label className="form-label">什么状态算完整结束</label>
              <textarea
                className="form-input min-h-[96px] resize-none"
                value={completionCriteria}
                onChange={(event) => handlers.onCompletionCriteriaChange(event.target.value)}
                placeholder="例如：主角揭开骗局来源，核心关系稳定，关键伏笔全部回收，并自然收束到终局。"
              />
            </div>
            {showAdvanced ? (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="grid gap-2">
                  <span className="form-label">章节规划模式</span>
                  <select
                    className="form-input"
                    value={effectivePlanningMode}
                    onChange={(event) => handlers.onPlanningModeChange(event.target.value as ChapterPlanningMode)}
                  >
                    <option value="dynamic">动态估算</option>
                    <option value="fixed">固定章节数</option>
                  </select>
                </label>
                {effectivePlanningMode === "fixed" ? (
                  <label className="grid gap-2">
                    <span className="form-label">固定章节数</span>
                    <input
                      type="number"
                      className="form-input"
                      value={targetChapters}
                      min={1}
                      max={200}
                      onChange={(event) => handlers.onTargetChaptersChange(Number(event.target.value))}
                    />
                  </label>
                ) : (
                  <label className="grid gap-2">
                    <span className="form-label">最大章节上限</span>
                    <input
                      type="number"
                      className="form-input"
                      value={hardChapterCap}
                      min={1}
                      max={200}
                      onChange={(event) => handlers.onHardChapterCapChange(Number(event.target.value))}
                    />
                  </label>
                )}
              </div>
            ) : null}
          </div>
        ) : null}

        <div>
          <label className="form-label">故事前提</label>
          <textarea
            className="form-input min-h-[120px] resize-none"
            value={premise}
            onChange={(event) => handlers.onPremiseChange(event.target.value)}
            placeholder="用一两句话描述核心故事设定…"
          />
        </div>

        {profiles.length ? (
          <div>
            <label className="form-label">角色模型分配</label>
            <div className="mt-1">
              <RoleAssignmentEditor
                profiles={profiles}
                assignments={assignments}
                onChange={handlers.onAssignmentsChange}
              />
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-muted)] px-4 py-3 text-sm text-[var(--ink-soft)]">
            <BookOpen className="mb-1 h-4 w-4" />
            尚未配置模型 Profile，请先前往「模型配置」添加后再创建项目。
          </div>
        )}

        <button
          className="btn-primary w-full justify-center"
          disabled={createDisabled}
          onClick={handlers.onCreate}
        >
          {createPending ? "创建中…" : "创建项目"}
        </button>
      </div>
    </section>
  );
}
