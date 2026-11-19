"use client";

import { type ReactNode } from "react";
import { StatusBadge } from "@/components/status-badge";
import type { WorkspaceTab } from "./use-project-queries";

interface ProjectHeaderProps {
  activeTabLabel: string;
  projectGenre: string;
  narrativePersonLabel: string;
  unitLabel: string;
  displayStatus: string;
  tabs: Array<{ key: WorkspaceTab; label: string; icon: ReactNode }>;
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  onToggleRightPanel: () => void;
}

export function ProjectHeader({
  activeTabLabel,
  projectGenre,
  narrativePersonLabel,
  unitLabel,
  displayStatus,
  tabs,
  activeTab,
  onTabChange,
  onToggleRightPanel,
}: ProjectHeaderProps) {
  return (
    <section className="workspace-panel p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex-1">
          <p className="section-title">Workspace</p>
          <h2 className="mt-2 text-3xl font-semibold [font-family:var(--font-serif)]">
            {activeTabLabel}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="workspace-pill px-4 py-2 text-sm text-[var(--ink-soft)]">
            {projectGenre}
          </span>
          <span className="workspace-pill px-4 py-2 text-sm text-[var(--ink-soft)]">
            {narrativePersonLabel}
          </span>
          <span className="workspace-pill px-4 py-2 text-sm text-[var(--ink-soft)]">
            {unitLabel}
          </span>
          <StatusBadge status={displayStatus} />
          <button
            onClick={onToggleRightPanel}
            className="workspace-pill px-4 py-2 text-sm text-[var(--ink-soft)] hover:bg-[var(--hover)]"
            title="打开项目信息面板"
          >
            ⚙️
          </button>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => onTabChange(tab.key)}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition ${
              activeTab === tab.key
                ? "bg-[var(--accent)] text-[var(--accent-ink)] shadow-[var(--shadow-soft)]"
                : "workspace-pill text-[var(--ink-soft)] hover:bg-[var(--hover)]"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>
    </section>
  );
}
