"use client";

import Link from "next/link";
import { BookOpen, Lightbulb } from "lucide-react";
import type { ProjectDetail } from "@/lib/types";
import { buildProjectStructureSummary, getNarrativePersonLabel } from "@/lib/project-structure";
import { CollapsibleSection } from "../collapsible-section";

interface IdeaInsightsSidebarProps {
  draft: {
    premise: string;
    mainline: string;
    storyHook: string;
    desiredTone: string;
    characterIdeas: Array<{ name: string; role: string; goal: string; traits: string[] }>;
    worldviewIdeas: Array<{ name: string; description: string }>;
    relationshipIdeas: Array<{ source: string; target: string; label: string }>;
    unresolvedQuestions: string[];
  } | null;
  projects: ProjectDetail["project"][];
}

export function IdeaInsightsSidebar({ draft, projects }: IdeaInsightsSidebarProps) {
  const detailSections = [
    {
      title: "Premise",
      content: draft?.premise || "还没有一句稳定 premise，继续聊就好。",
    },
    {
      title: "主线",
      content: draft?.mainline || "主线还在打磨中。",
    },
    {
      title: "钩子",
      content: draft?.storyHook || "开场钩子还没钉死。",
    },
    {
      title: "气质",
      content: draft?.desiredTone || "还没固定文气或基调。",
    },
  ];

  return (
    <aside className="grid gap-4">
      <section className="workspace-panel p-5">
        <div className="flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-[var(--accent)]" />
          <h3 className="text-lg font-semibold">当前想法沉淀</h3>
        </div>
        <div className="mt-4 grid gap-3 text-sm text-[var(--ink-soft)]">
          {detailSections.map((section) => (
            <CollapsibleSection
              key={section.title}
              title={section.title}
              eyebrow="Draft"
              defaultOpen
              className="bg-[var(--panel-soft)]"
            >
              <p className="leading-7">{section.content}</p>
            </CollapsibleSection>
          ))}
          <CollapsibleSection
            title="角色草案"
            eyebrow="Characters"
            summaryRight={(
              <span className="workspace-pill px-2.5 py-1 text-xs text-[var(--ink-soft)]">
                {draft?.characterIdeas.length ?? 0} 人
              </span>
            )}
            className="bg-[var(--panel-soft)]"
          >
            <div className="grid gap-2">
              {draft?.characterIdeas.length ? draft.characterIdeas.map((character) => (
                <div key={`${character.name}-${character.role}`} className="workspace-item active p-3">
                  <p className="font-semibold text-[var(--ink)]">{character.name}</p>
                  <p className="mt-1 leading-6">{character.role} / 目标：{character.goal}</p>
                </div>
              )) : <p>还没有固定角色。</p>}
            </div>
          </CollapsibleSection>
          <CollapsibleSection
            title="世界观草案"
            eyebrow="World"
            summaryRight={(
              <span className="workspace-pill px-2.5 py-1 text-xs text-[var(--ink-soft)]">
                {draft?.worldviewIdeas.length ?? 0} 条
              </span>
            )}
            className="bg-[var(--panel-soft)]"
          >
            <div className="grid gap-2">
              {draft?.worldviewIdeas.length ? draft.worldviewIdeas.map((entry) => (
                <div key={entry.name} className="workspace-item active p-3">
                  <p className="font-semibold text-[var(--ink)]">{entry.name}</p>
                  <p className="mt-1 leading-6">{entry.description}</p>
                </div>
              )) : <p>还没有稳定的世界规则。</p>}
            </div>
          </CollapsibleSection>
          <CollapsibleSection
            title="已开项目"
            eyebrow="Projects"
            summaryRight={(
              <span className="workspace-pill px-2.5 py-1 text-xs text-[var(--ink-soft)]">
                {projects.length} 个
              </span>
            )}
            className="bg-[var(--panel-soft)]"
          >
            <div className="grid gap-2">
              {projects.length ? projects.map((project) => (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="workspace-item active p-3"
                >
                  <p className="font-semibold text-[var(--ink)]">{project.title}</p>
                  <p className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">
                    {project.genre} · {buildProjectStructureSummary(project)}
                  </p>
                  <p className="mt-2 text-xs text-[var(--ink-soft)]">
                    {getNarrativePersonLabel(project.narrativePerson)} · 更新于 {project.updatedAt
                      ? new Date(project.updatedAt).toLocaleDateString("zh-CN")
                      : "未知"}
                  </p>
                </Link>
              )) : <p>这份想法还没有开过项目。</p>}
            </div>
          </CollapsibleSection>
        </div>
      </section>

      <section className="workspace-panel p-5">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-[var(--accent)]" />
          <h3 className="text-lg font-semibold">提示</h3>
        </div>
        <p className="mt-4 text-sm leading-7 text-[var(--ink-soft)]">
          想法区只负责沉淀创意。真正进入项目以后，再去挑作者文风、整理正式设定和启动写作。
        </p>
      </section>
    </aside>
  );
}
