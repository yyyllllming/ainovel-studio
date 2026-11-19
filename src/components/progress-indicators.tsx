"use client";

import { CheckCircle } from "lucide-react";

/* ═══════════════════════════════════════════════════════════
   ProgressBar — 简单的百分比进度条
   ═══════════════════════════════════════════════════════════ */

interface ProgressBarProps {
  /** 0-100 */
  percent: number;
  /** 可选标签（左侧） */
  label?: string;
  /** 是否展示百分比文字（右侧） */
  showPercent?: boolean;
  /** 进度条颜色，默认 var(--accent) */
  color?: string;
  /** 是否显示动画条纹（indeterminate 风格）*/
  animated?: boolean;
  className?: string;
}

export function ProgressBar({
  percent,
  label,
  showPercent = true,
  color,
  animated,
  className = "",
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, percent));

  return (
    <div className={`w-full ${className}`}>
      {(label || showPercent) && (
        <div className="mb-2 flex items-center justify-between gap-3">
          {label && (
            <span className="text-xs font-medium text-[var(--ink-soft)]">{label}</span>
          )}
          {showPercent && (
            <span className="text-xs tabular-nums text-[var(--ink-soft)]">
              {Math.round(clamped)}%
            </span>
          )}
        </div>
      )}
      <div className="h-2 overflow-hidden rounded-full bg-[var(--line)]">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ease-out ${
            animated ? "ainovel-progress-stripe" : ""
          }`}
          style={{
            width: `${clamped}%`,
            background: color ?? "var(--accent)",
          }}
        />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   StageIndicator — 多阶段步骤指示器
   ═══════════════════════════════════════════════════════════ */

type StageStatus = "pending" | "active" | "completed" | "error";

export interface StageItem {
  key: string;
  label: string;
  /** 可选的辅助说明 */
  description?: string;
  status: StageStatus;
}

interface StageIndicatorProps {
  stages: StageItem[];
  /** 可选：总体进度文字 */
  summary?: string;
  className?: string;
}

const stageColors: Record<StageStatus, { dot: string; text: string; line: string }> = {
  pending: {
    dot: "border-[var(--line)] bg-transparent",
    text: "text-[var(--ink-soft)] opacity-50",
    line: "bg-[var(--line)]",
  },
  active: {
    dot: "border-[var(--accent)] bg-[var(--accent)] shadow-[0_0_8px_var(--accent-soft)]",
    text: "text-[var(--accent)] font-semibold",
    line: "bg-[var(--line)]",
  },
  completed: {
    dot: "border-[var(--success)] bg-[var(--success)]",
    text: "text-[var(--success)]",
    line: "bg-[var(--success)]",
  },
  error: {
    dot: "border-[var(--danger)] bg-[var(--danger)]",
    text: "text-[var(--danger)]",
    line: "bg-[var(--danger)]",
  },
};

export function StageIndicator({ stages, summary, className = "" }: StageIndicatorProps) {
  return (
    <div className={`w-full ${className}`}>
      {summary && (
        <p className="mb-3 text-xs font-medium text-[var(--ink-soft)]">{summary}</p>
      )}

      <div className="flex items-start gap-0">
        {stages.map((stage, index) => {
          const color = stageColors[stage.status];
          const isLast = index === stages.length - 1;
          const isCompleted = stage.status === "completed";
          const isActive = stage.status === "active";

          return (
            <div
              key={stage.key}
              className={`flex flex-col items-center ${isLast ? "" : "flex-1"}`}
            >
              {/* dot + connecting line row */}
              <div className="flex w-full items-center">
                {/* dot / check */}
                <div className="relative flex items-center justify-center">
                  <div
                    className={`h-6 w-6 rounded-full border-2 transition-all duration-300 flex items-center justify-center ${color.dot} ${
                      isActive ? "ainovel-stage-pulse" : ""
                    }`}
                  >
                    {isCompleted && (
                      <CheckCircle className="h-3.5 w-3.5 text-[var(--surface)]" />
                    )}
                  </div>
                </div>

                {/* line */}
                {!isLast && (
                  <div className="flex-1 mx-1">
                    <div
                      className={`h-[2px] rounded-full transition-colors duration-300 ${
                        stage.status === "completed" ? color.line : "bg-[var(--line)]"
                      }`}
                    />
                  </div>
                )}
              </div>

              {/* label below the dot */}
              <div className={`mt-2 text-center ${isLast ? "" : "w-full"}`}>
                <p
                  className={`text-xs leading-4 transition-colors duration-200 ${color.text}`}
                >
                  {stage.label}
                </p>
                {stage.description && (
                  <p className="mt-0.5 text-[10px] leading-3 text-[var(--ink-soft)] opacity-60">
                    {stage.description}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   StreamingProgress — 流式任务进度指示
   ═══════════════════════════════════════════════════════════ */

interface StreamingProgressProps {
  /** 当前阶段标签 */
  stageLabel: string;
  /** 已完成字数或步骤数 */
  current?: number;
  /** 预估总量 */
  total?: number;
  /** 可选单位，默认 "字" */
  unit?: string;
  /** 是否正在运行 */
  active?: boolean;
  className?: string;
}

export function StreamingProgress({
  stageLabel,
  current,
  total,
  unit = "字",
  active = true,
  className = "",
}: StreamingProgressProps) {
  const percent =
    total && total > 0 ? Math.min(100, Math.round((current ?? 0) / total * 100)) : undefined;

  return (
    <div
      className={`rounded-3xl border border-[var(--line)] bg-[var(--panel-soft)] p-4 ${className}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {active && (
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent)] opacity-50" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--accent)]" />
            </span>
          )}
          <p className="text-sm font-semibold text-[var(--ink)]">{stageLabel}</p>
        </div>
        {percent !== undefined && (
          <span className="text-xs tabular-nums text-[var(--ink-soft)]">{percent}%</span>
        )}
      </div>

      {percent !== undefined && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--line)]">
          <div
            className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-500 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>
      )}

      {(current !== undefined || total !== undefined) && (
        <div className="mt-2.5 flex flex-wrap gap-3 text-xs text-[var(--ink-soft)]">
          {current !== undefined && (
            <span>
              已完成 {current.toLocaleString()} {unit}
            </span>
          )}
          {total !== undefined && total > 0 && (
            <span>
              目标约 {total.toLocaleString()} {unit}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
