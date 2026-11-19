"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function ProjectWorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-6 py-12">
      <div className="workspace-panel max-w-xl p-8 text-center">
        <p className="section-title">Project Workspace Error</p>
        <h2 className="mt-2 text-2xl font-semibold [font-family:var(--font-serif)]">当前项目工作台加载失败</h2>
        <p className="mt-4 text-sm leading-7 text-[var(--ink-soft)]">
          错误已经被限制在当前项目页内，不会影响其他页面。你可以先重试一次，或者返回项目列表继续工作。
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button className="btn-primary" onClick={() => reset()}>
            重新加载工作台
          </button>
          <Link className="btn-secondary" href="/projects">
            返回项目列表
          </Link>
        </div>
        {process.env.NODE_ENV !== "production" ? (
          <pre className="mt-6 overflow-x-auto rounded-2xl bg-[var(--panel-soft)] p-4 text-left text-xs leading-6 text-[var(--ink-soft)]">
            {error.stack ?? error.message}
          </pre>
        ) : null}
      </div>
    </div>
  );
}
