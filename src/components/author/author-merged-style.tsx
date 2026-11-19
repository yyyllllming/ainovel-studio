"use client";

import { CollapsibleSection } from "@/components/collapsible-section";
import type { AuthorCardVersionDetail } from "@/lib/types";
import { formatConfidence, formatDateTime } from "./author-utils";

export function AuthorMergedStyle({
  latestVersion,
  authorProfile,
  canMerge,
  mergePending,
  onMerge,
}: {
  latestVersion: AuthorCardVersionDetail | null;
  authorProfile: {
    profileMode: "single-book inferred" | "multi-book stable";
    authorProfileSummary: string;
    stableTraits: string[];
    bookSpecificTraits: Array<{ title: string; traits: string[] }>;
    coverageReport: {
      bookCount: number;
      withStyleProfileCount: number;
      withFingerprintCount: number;
    };
  } | null | undefined;
  canMerge: boolean;
  mergePending: boolean;
  onMerge: () => void;
}) {
  return (
    <div className="workspace-item active p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="section-title">Merged Style</p>
          <h3 className="mt-2 text-lg font-semibold text-[var(--ink)]">合并的作者风格</h3>
          <p className="mt-2 text-sm leading-7 text-[var(--ink-soft)]">
            基于当前作者名下的书级风格卡合并得到的 author 级风格。项目页应用作者卡时，会默认使用这里的最新版本。
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary px-3 py-2 text-xs"
          disabled={!canMerge || mergePending}
          onClick={onMerge}
        >
          {mergePending ? "重新合并中…" : "重新合并"}
        </button>
      </div>

      {latestVersion ? (
        <div className="mt-4 grid gap-4">
          {authorProfile ? (
            <CollapsibleSection
              title="作者画像"
              eyebrow="Profile"
              defaultOpen
              className="bg-[var(--panel-soft)]"
            >
              <div className="grid gap-3 text-sm text-[var(--ink-soft)]">
                <p className="leading-7">{authorProfile.authorProfileSummary}</p>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="workspace-pill px-2.5 py-1">{authorProfile.profileMode}</span>
                  <span className="workspace-pill px-2.5 py-1">书卡 {authorProfile.coverageReport.bookCount}</span>
                  <span className="workspace-pill px-2.5 py-1">结构画像 {authorProfile.coverageReport.withStyleProfileCount}</span>
                  <span className="workspace-pill px-2.5 py-1">指纹 {authorProfile.coverageReport.withFingerprintCount}</span>
                </div>
                {authorProfile.stableTraits.length ? (
                  <div className="grid gap-2">
                    {authorProfile.stableTraits.map((trait) => (
                      <div key={trait} className="workspace-item active p-3">{trait}</div>
                    ))}
                  </div>
                ) : null}
                {authorProfile.bookSpecificTraits.some((entry) => entry.traits.length > 0) ? (
                  <div className="grid gap-2">
                    {authorProfile.bookSpecificTraits
                      .filter((entry) => entry.traits.length > 0)
                      .map((entry) => (
                        <div key={entry.title} className="workspace-item p-3">
                          <p className="font-semibold text-[var(--ink)]">{entry.title}</p>
                          <p className="mt-2 leading-7">{entry.traits.join("；")}</p>
                        </div>
                      ))}
                  </div>
                ) : null}
              </div>
            </CollapsibleSection>
          ) : null}
          <div className="flex flex-wrap gap-2 text-xs text-[var(--ink-soft)]">
            <span className="workspace-pill px-2.5 py-1">v{latestVersion.version}</span>
            <span className="workspace-pill px-2.5 py-1">置信度 {formatConfidence(latestVersion.confidence)}</span>
            <span className="workspace-pill px-2.5 py-1">{formatDateTime(latestVersion.createdAt)}</span>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-7 text-[var(--ink-soft)]">{latestVersion.styleDigest}</p>
          <CollapsibleSection
            title="查看完整作者风格卡"
            eyebrow="Style Card"
            className="bg-[var(--panel-soft)]"
          >
            <pre className="whitespace-pre-wrap text-sm leading-7 text-[var(--ink-soft)]">{latestVersion.styleCard}</pre>
          </CollapsibleSection>
        </div>
      ) : (
        <div className="mt-4 grid gap-3 text-sm text-[var(--ink-soft)]">
          {authorProfile ? (
            <div className="workspace-item p-3">
              <p className="leading-7">{authorProfile.authorProfileSummary}</p>
            </div>
          ) : null}
          <p>这个作者还没有 author 级合并风格。至少生成 2 张书级风格卡后，才能执行合并。</p>
        </div>
      )}
    </div>
  );
}
