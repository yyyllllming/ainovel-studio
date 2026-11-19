import { ManuscriptPreviewClient } from "@/components/manuscript-preview-client";
import { getProjectManuscriptPreview } from "@/server/services/project.service";

export default async function ProjectPreviewPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const [initialMarkdownPreview, initialTextPreview] = await Promise.all([
    getProjectManuscriptPreview(projectId, "md"),
    getProjectManuscriptPreview(projectId, "txt"),
  ]);

  return (
    <ManuscriptPreviewClient
      projectId={projectId}
      initialMarkdownPreview={initialMarkdownPreview}
      initialTextPreview={initialTextPreview}
    />
  );
}
