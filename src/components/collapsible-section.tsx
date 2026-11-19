"use client";

import type { ReactNode } from "react";
import { clsx } from "clsx";
import { ChevronDown } from "lucide-react";

interface CollapsibleSectionProps {
  title: string;
  eyebrow?: string;
  description?: string;
  defaultOpen?: boolean;
  summaryRight?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}

export function CollapsibleSection({
  title,
  eyebrow,
  description,
  defaultOpen = false,
  summaryRight,
  className,
  bodyClassName,
  children,
}: CollapsibleSectionProps) {
  return (
    <details open={defaultOpen} className={clsx("group workspace-panel overflow-hidden", className)}>
      <summary className="list-none cursor-pointer px-5 py-4 [&::-webkit-details-marker]:hidden">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            {eyebrow ? <p className="section-title">{eyebrow}</p> : null}
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-[var(--ink)] [font-family:var(--font-serif)]">{title}</h3>
              {summaryRight}
            </div>
            {description ? (
              <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">{description}</p>
            ) : null}
          </div>
          <span className="mt-1 inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--panel-muted)] text-[var(--ink-soft)]">
            <ChevronDown className="h-4 w-4 transition-transform duration-200 group-open:rotate-180" />
          </span>
        </div>
      </summary>
      <div className={clsx("border-t border-[var(--line)] px-5 py-4", bodyClassName)}>
        {children}
      </div>
    </details>
  );
}
