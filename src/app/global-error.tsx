"use client";

import { useEffect } from "react";

export default function GlobalError({
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
    <html lang="zh-CN">
      <body>
        <div className="flex min-h-screen items-center justify-center px-6 py-12">
          <div className="workspace-panel max-w-xl p-8 text-center">
            <p className="section-title">Application Error</p>
            <h2 className="mt-2 text-2xl font-semibold [font-family:var(--font-serif)]">应用在根布局阶段出错了</h2>
            <p className="mt-4 text-sm leading-7 text-[var(--ink-soft)]">
              这次错误影响到了全局布局。点击重试会重新挂载整棵应用树。
            </p>
            <button className="btn-primary mt-6" onClick={() => reset()}>
              重新尝试
            </button>
            {process.env.NODE_ENV !== "production" ? (
              <pre className="mt-6 overflow-x-auto rounded-2xl bg-[var(--panel-soft)] p-4 text-left text-xs leading-6 text-[var(--ink-soft)]">
                {error.stack ?? error.message}
              </pre>
            ) : null}
          </div>
        </div>
      </body>
    </html>
  );
}
