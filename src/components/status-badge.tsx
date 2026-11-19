import clsx from "clsx";

type BadgeKind =
  | "idle"
  | "blueprint"
  | "writing"
  | "review"
  | "alert"
  | "done"
  | "warn";

/* 边框色由状态前景色 color-mix 派生，随宣纸/夜墨主题自动适配。 */
const kindClasses: Record<BadgeKind, string> = {
  idle: "border-[var(--line)] bg-[var(--status-idle-bg)] text-[var(--status-idle-fg)]",
  blueprint:
    "border-[color-mix(in_srgb,var(--status-blueprint-fg)_32%,transparent)] bg-[var(--status-blueprint-bg)] text-[var(--status-blueprint-fg)]",
  writing:
    "border-[color-mix(in_srgb,var(--status-writing-fg)_32%,transparent)] bg-[var(--status-writing-bg)] text-[var(--status-writing-fg)]",
  review:
    "border-[color-mix(in_srgb,var(--status-review-fg)_36%,transparent)] bg-[var(--status-review-bg)] text-[var(--status-review-fg)]",
  alert:
    "border-[color-mix(in_srgb,var(--status-alert-fg)_36%,transparent)] bg-[var(--status-alert-bg)] text-[var(--status-alert-fg)]",
  done: "border-[color-mix(in_srgb,var(--status-done-fg)_32%,transparent)] bg-[var(--status-done-bg)] text-[var(--status-done-fg)]",
  warn: "border-[color-mix(in_srgb,var(--status-warn-fg)_32%,transparent)] bg-[var(--status-warn-bg)] text-[var(--status-warn-fg)]",
};

const statusKind: Record<string, BadgeKind> = {
  idle: "idle",
  draft: "idle",
  paused: "idle",
  stopped: "idle",
  hint: "idle",
  blueprint: "blueprint",
  context: "warn",
  style_pass: "warn",
  analysis: "warn",
  stopping: "warn",
  interrupted: "warn",
  ideation: "warn",
  warn: "warn",
  warning: "warn",
  writing: "writing",
  foundation_ready: "writing",
  review: "review",
  manual_review: "alert",
  failed: "alert",
  error: "alert",
  completed: "done",
  confirmed: "done",
  foundation_locked: "done",
};

const labels: Record<string, string> = {
  idle:              "空闲",
  draft:             "草稿",
  blueprint:         "蓝图",
  context:           "上下文",
  writing:           "写作中",
  style_pass:        "润色中",
  review:            "审核中",
  analysis:          "分析中",
  completed:         "已完成",
  confirmed:         "已确认",
  paused:            "已暂停",
  stopped:           "已停止",
  stopping:          "停止中",
  interrupted:       "已中断",
  manual_review:     "待确认",
  failed:            "失败",
  ideation:          "整理中",
  foundation_ready:  "设定可用",
  foundation_locked: "设定已锁定",
  warn:              "警告",
  warning:           "警告",
  error:             "错误",
  hint:              "提示",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={clsx(
        "inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold tracking-[0.14em]",
        kindClasses[statusKind[status] ?? "idle"],
      )}
    >
      {labels[status] ?? status.replaceAll("_", " ")}
    </span>
  );
}
