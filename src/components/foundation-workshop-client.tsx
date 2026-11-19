"use client";

import { StyleReferenceSelector } from "./foundation/style-reference-selector";
import { ManualFoundationImport } from "./foundation/manual-foundation-import";
import { WorkshopEditor } from "./foundation/workshop-editor";
import { WorkshopHeader } from "./foundation/workshop-header";
import { useFoundationWorkshopController } from "./foundation/use-foundation-workshop-controller";
import type { FoundationPayload, SourceIdeaSummary } from "@/lib/types";

export function FoundationWorkshopClient({
  projectId,
  foundation,
  foundationLocked,
  sourceIdea,
}: {
  projectId: string;
  foundation: FoundationPayload | null;
  foundationLocked: boolean;
  sourceIdea?: SourceIdeaSummary | null;
}) {
  const controller = useFoundationWorkshopController({
    projectId,
    foundation,
    foundationLocked,
    sourceIdea,
  });

  return (
    <section className="workspace-panel p-6">
      <WorkshopHeader {...controller.headerProps} />
      <div className="mt-6">
        <StyleReferenceSelector {...controller.styleSelectorProps} />
      </div>
      <ManualFoundationImport projectId={projectId} disabled={foundationLocked} />
      <WorkshopEditor {...controller.editorProps} />
    </section>
  );
}
