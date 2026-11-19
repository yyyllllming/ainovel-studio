"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function SettingsError({
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
        <p className="section-title">Settings Error</p>
        <h2 className="mt-2 text-2xl font-semibold [font-family:var(--font-serif)]">设置页暂时无法渲染</h2>
        <p className="mt-4 text-sm leading-7 text-[var(--ink-soft)]">
          这次错误只影响设置区域，不会拖垮整个应用。你可以重试一次，或者先回到项目页继续工作。
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button className="btn-primary" onClick={() => reset()}>
            重试设置页
          </button>
          <Link className="btn-secondary" href="/projects">
            返回项目页
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
