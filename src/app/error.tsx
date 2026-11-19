"use client";

import { useEffect } from "react";

export default function Error({
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
        <p className="section-title">Something Went Wrong</p>
        <h2 className="mt-2 text-2xl font-semibold [font-family:var(--font-serif)]">当前页面暂时打不开</h2>
        <p className="mt-4 text-sm leading-7 text-[var(--ink-soft)]">
          渲染过程中遇到了意外错误。你可以先重试一次，通常临时状态会自动恢复。
        </p>
        <button className="btn-primary mt-6" onClick={() => reset()}>
          重新加载页面
        </button>
        {process.env.NODE_ENV !== "production" ? (
          <pre className="mt-6 overflow-x-auto rounded-2xl bg-[var(--panel-soft)] p-4 text-left text-xs leading-6 text-[var(--ink-soft)]">
            {error.stack ?? error.message}
          </pre>
        ) : null}
      </div>
    </div>
  );
}
