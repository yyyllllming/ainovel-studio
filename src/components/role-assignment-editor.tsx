"use client";

import {
  createDefaultAssignments,
  normalizeAssignments,
  type AgentAssignmentValue as RoleAssignmentValue,
  type AgentProfileOption,
  type ProjectAgentRole as RoleKey,
} from "@/lib/agent-assignments";

export { createDefaultAssignments, normalizeAssignments };
export type { RoleAssignmentValue };

export interface RoleProfileOption extends AgentProfileOption {
  name: string;
  baseUrl?: string;
}

const roleLabels: Record<RoleKey, { title: string; hint: string }> = {
  coauthor: {
    title: "设定整理",
    hint: "负责设定整理、卡片补充和正式设定落盘",
  },
  planner: {
    title: "结构规划",
    hint: "负责章节蓝图与推进节奏规划",
  },
  writer: {
    title: "正文生成",
    hint: "负责正文输出与续写",
  },
  reviewer: {
    title: "审校收束",
    hint: "负责审校、局部修订和收尾分析",
  },
};

export function RoleAssignmentEditor({
  profiles,
  assignments,
  onChange,
  title = "模型分配",
  subtitle = "按环节绑定具体配置，系统会严格照这里执行。",
}: {
  profiles: RoleProfileOption[];
  assignments: RoleAssignmentValue[];
  onChange: (next: RoleAssignmentValue[]) => void;
  title?: string;
  subtitle?: string;
}) {
  const safeAssignments = normalizeAssignments(assignments, profiles);

  function updateRole(role: RoleKey, patch: Partial<RoleAssignmentValue>) {
    const next = safeAssignments.map((assignment) => {
      if (assignment.role !== role) {
        return assignment;
      }
      const merged = { ...assignment, ...patch };
      if (patch.profileId) {
        const selected = profiles.find((profile) => profile.id === patch.profileId);
        if (selected && (!patch.model || patch.model === assignment.model)) {
          merged.model = selected.defaultModel || merged.model;
        }
      }
      return merged;
    });
    onChange(next);
  }

  return (
    <div className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--panel-muted)] p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold [font-family:var(--font-serif)]">{title}</h3>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">{subtitle}</p>
        </div>
        <span className="text-xs uppercase tracking-[0.2em] text-[var(--ink-soft)]">
          手动指定
        </span>
      </div>

      <div className="mt-5 grid gap-4">
        {safeAssignments.map((assignment) => {
          const roleMeta = roleLabels[assignment.role];
          const currentProfile = profiles.find((profile) => profile.id === assignment.profileId);
          return (
            <div
              key={assignment.role}
              className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-semibold">{roleMeta.title}</p>
                  <p className="mt-1 text-sm text-[var(--ink-soft)]">{roleMeta.hint}</p>
                </div>
                <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-soft)]">
                  {currentProfile?.name ?? "未绑定"}
                </p>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <label className="grid gap-2 text-sm">
                  配置档
                  <select
                    className="form-input"
                    value={assignment.profileId}
                    onChange={(event) =>
                      updateRole(assignment.role, { profileId: event.target.value })
                    }
                  >
                    {profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-2 text-sm">
                  模型名
                  <input
                    className="form-input"
                    value={assignment.model}
                    onChange={(event) =>
                      updateRole(assignment.role, { model: event.target.value })
                    }
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  Temperature
                  <input
                    className="form-input"
                    type="number"
                    step="0.1"
                    min="0"
                    max="2"
                    value={assignment.temperature}
                    onChange={(event) =>
                      updateRole(assignment.role, {
                        temperature: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  Max Tokens
                  <input
                    className="form-input"
                    type="number"
                    min="256"
                    step="256"
                    value={assignment.maxTokens}
                    onChange={(event) =>
                      updateRole(assignment.role, {
                        maxTokens: Number(event.target.value),
                      })
                    }
                  />
                </label>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
