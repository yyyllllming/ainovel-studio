/**
 * LoadingSkeleton — 统一加载占位组件
 *
 * 替代项目中散落的临时 loading 实现：
 *  - "加载中…" 纯文本
 *  - 手写 shimmer div
 *  - WorkspaceLoadingPane
 *
 * 三种变体：card / list / text
 */

interface LoadingSkeletonProps {
  /** 骨架屏变体 */
  variant: "card" | "list" | "text";
  /** 重复数量（card/list 模式下生效） */
  count?: number;
  /** 自定义 className */
  className?: string;
}

function SkeletonPulse({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-full bg-[var(--line)] ${className ?? ""}`}
      aria-hidden="true"
    />
  );
}

function CardSkeleton() {
  return (
    <div className="workspace-panel p-6" role="status" aria-label="加载中">
      <SkeletonPulse className="h-5 w-1/2" />
      <SkeletonPulse className="mt-3 h-4 w-2/3" />
      <SkeletonPulse className="mt-8 h-20 rounded-2xl" />
      <span className="sr-only">加载中…</span>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="workspace-item active px-4 py-3" role="status" aria-label="加载中">
      <div className="flex items-center justify-between gap-3">
        <SkeletonPulse className="h-4 w-1/3" />
        <SkeletonPulse className="h-4 w-16" />
      </div>
      <SkeletonPulse className="mt-3 h-3 w-full" />
      <SkeletonPulse className="mt-2 h-3 w-4/5" />
      <span className="sr-only">加载中…</span>
    </div>
  );
}

function TextSkeleton() {
  return (
    <div className="grid gap-2" role="status" aria-label="加载中">
      <SkeletonPulse className="h-4 w-full" />
      <SkeletonPulse className="h-4 w-5/6" />
      <SkeletonPulse className="h-4 w-3/4" />
      <span className="sr-only">加载中…</span>
    </div>
  );
}

export function LoadingSkeleton({ variant, count = 1, className }: LoadingSkeletonProps) {
  const items = Array.from({ length: count }, (_, index) => index);

  const Skeleton =
    variant === "card" ? CardSkeleton : variant === "list" ? ListSkeleton : TextSkeleton;

  const containerClass =
    variant === "card"
      ? `grid gap-4 md:grid-cols-2 xl:grid-cols-3 ${className ?? ""}`
      : `grid gap-3 ${className ?? ""}`;

  if (count === 1) {
    return (
      <div className={className}>
        <Skeleton />
      </div>
    );
  }

  return (
    <div className={containerClass}>
      {items.map((index) => (
        <Skeleton key={index} />
      ))}
    </div>
  );
}
