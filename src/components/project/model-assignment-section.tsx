"use client";

import type { LlmProfile, ReviewPolicyDraft } from "@/lib/types";
import {
  RoleAssignmentEditor,
  type RoleAssignmentValue,
} from "@/components/role-assignment-editor";

interface ModelAssignmentSectionProps {
  profiles: LlmProfile[];
  assignments: RoleAssignmentValue[];
  onAssignmentsChange: (next: RoleAssignmentValue[]) => void;
  saveAssignmentsPending: boolean;
  onSaveAssignments: () => void;
  deepReviewStartChapter: number;
  cadenceChapters: number;
  reviewPolicyDraft: ReviewPolicyDraft | null;
  defaultReviewPolicy: ReviewPolicyDraft;
  onReviewPolicyDraftChange: (next: ReviewPolicyDraft) => void;
  saveReviewPolicyPending: boolean;
  onSaveReviewPolicy: () => void;
}

export function ModelAssignmentSection({
  profiles,
  assignments,
  onAssignmentsChange,
  saveAssignmentsPending,
  onSaveAssignments,
  deepReviewStartChapter,
  cadenceChapters,
  reviewPolicyDraft,
  defaultReviewPolicy,
  onReviewPolicyDraftChange,
  saveReviewPolicyPending,
  onSaveReviewPolicy,
}: ModelAssignmentSectionProps) {
  if (!profiles.length) {
    return (
      <section className="workspace-panel p-6">
        <p className="section-title">Model Assignments</p>
        <h3 className="mt-2 text-2xl font-semibold [font-family:var(--font-serif)]">模型分配</h3>
        <p className="mt-5 text-sm text-[var(--ink-soft)]">请先在「模型配置」中添加 Profile。</p>
      </section>
    );
  }

  return (
    <section className="workspace-panel p-6">
      <p className="section-title">Model Assignments</p>
      <h3 className="mt-2 text-2xl font-semibold [font-family:var(--font-serif)]">模型分配</h3>
      <p className="mt-3 text-sm leading-7 text-[var(--ink-soft)]">
        为各环节绑定具体模型，写作流程将按此配置执行。
      </p>
      <div className="mt-5">
        <RoleAssignmentEditor
          profiles={profiles}
          assignments={assignments}
          onChange={onAssignmentsChange}
          title="当前项目模型配置"
          subtitle="调整适用于当前项目各环节的模型分配"
        />
        <button
          className="btn-primary mt-5"
          disabled={saveAssignmentsPending}
          onClick={onSaveAssignments}
        >
          {saveAssignmentsPending ? "保存中…" : "保存模型分配"}
        </button>

        <div className="mt-8 rounded-3xl border border-[var(--line)] bg-[var(--panel-soft)] p-5">
          <p className="section-title">Review Policy</p>
          <h4 className="mt-2 text-xl font-semibold [font-family:var(--font-serif)]">深审策略</h4>
          <p className="mt-2 text-sm leading-7 text-[var(--ink-soft)]">
            当前项目从第 {deepReviewStartChapter} 章起启用深审，
            之后默认每 {cadenceChapters} 章复核一次。
            在这之前只保留极简检查和自动 prose 修整；硬冲突或手动检查点仍可提前兜底。
          </p>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <label className="grid gap-2">
              <span className="form-label">深审启用章节</span>
              <input
                type="number"
                min={1}
                className="form-input"
                value={reviewPolicyDraft?.deepReviewStartChapter ?? defaultReviewPolicy.deepReviewStartChapter}
                onChange={(event) =>
                  onReviewPolicyDraftChange({
                    cadenceChapters: reviewPolicyDraft?.cadenceChapters ?? defaultReviewPolicy.cadenceChapters,
                    deepReviewStartChapter:
                      Number(event.target.value) || defaultReviewPolicy.deepReviewStartChapter,
                    manualCheckpointChapters:
                      reviewPolicyDraft?.manualCheckpointChapters ?? defaultReviewPolicy.manualCheckpointChapters,
                  })}
              />
            </label>
            <label className="grid gap-2">
              <span className="form-label">深审周期</span>
              <input
                type="number"
                min={1}
                className="form-input"
                value={reviewPolicyDraft?.cadenceChapters ?? defaultReviewPolicy.cadenceChapters}
                onChange={(event) =>
                  onReviewPolicyDraftChange({
                    cadenceChapters: Number(event.target.value) || defaultReviewPolicy.cadenceChapters,
                    deepReviewStartChapter:
                      reviewPolicyDraft?.deepReviewStartChapter ?? defaultReviewPolicy.deepReviewStartChapter,
                    manualCheckpointChapters:
                      reviewPolicyDraft?.manualCheckpointChapters ?? defaultReviewPolicy.manualCheckpointChapters,
                  })}
              />
            </label>
            <label className="grid gap-2">
              <span className="form-label">关键检查点章节</span>
              <input
                className="form-input"
                value={reviewPolicyDraft?.manualCheckpointChapters ?? defaultReviewPolicy.manualCheckpointChapters}
                onChange={(event) =>
                  onReviewPolicyDraftChange({
                    cadenceChapters: reviewPolicyDraft?.cadenceChapters ?? defaultReviewPolicy.cadenceChapters,
                    deepReviewStartChapter:
                      reviewPolicyDraft?.deepReviewStartChapter ?? defaultReviewPolicy.deepReviewStartChapter,
                    manualCheckpointChapters: event.target.value,
                  })}
                placeholder="例如：3, 8, 12"
              />
            </label>
          </div>
          <p className="mt-3 text-sm text-[var(--ink-soft)]">
            启用章节之前，低置信度和大进展不会把早期章节拉去深审；重点先把首次成稿写稳。
          </p>
          <button
            className="btn-primary mt-5"
            disabled={saveReviewPolicyPending}
            onClick={onSaveReviewPolicy}
          >
            {saveReviewPolicyPending ? "保存中…" : "保存深审策略"}
          </button>
        </div>
      </div>
    </section>
  );
}
