/**
 * ChapterVersions — 版本历史面板
 * 从 chapter-workshop-client.tsx 提取
 */

import { StatusBadge } from "../status-badge";

interface Version {
  id: string;
  versionNo: number;
  temperature: number;
  excerpt: string;
  selected: boolean;
}

interface ChapterVersionsProps {
  versions: Version[];
  onRollback: (versionId: string, versionNo: number) => void;
}

export function ChapterVersions({ versions, onRollback }: ChapterVersionsProps) {
  if (!versions.length) {
    return <p className="text-sm text-[var(--ink-soft)]">还没有版本历史。</p>;
  }

  return (
    <div className="grid gap-3">
      {versions.map((version) => (
        <div key={version.id} className="workspace-item active px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-[var(--ink)]">版本 {version.versionNo}</p>
              <p className="mt-1 text-xs text-[var(--ink-soft)]">temperature={version.temperature}</p>
            </div>
            <div className="flex items-center gap-2">
              {version.selected ? <StatusBadge status="completed" /> : null}
              <button
                className="btn-secondary px-3 py-1.5 text-xs"
                aria-label={`回滚到版本 ${version.versionNo}`}
                onClick={() => onRollback(version.id, version.versionNo)}
              >
                回滚
              </button>
            </div>
          </div>
          <p className="mt-3 text-sm leading-6 text-[var(--ink-soft)]">{version.excerpt}</p>
        </div>
      ))}
    </div>
  );
}
