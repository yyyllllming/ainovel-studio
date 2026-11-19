import { ProjectDetailClient } from "@/components/project-detail-client";
import { getRunProgress } from "@/server/run/progress.service";
import { listProjectCards } from "@/server/services/card.service";
import { getProjectDetail } from "@/server/services/project.service";
import { listPublicProfiles } from "@/server/services/settings.service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const [initialSnapshot, initialProgress, profiles] = await Promise.all([
    getProjectDetail(projectId),
    Promise.resolve(getRunProgress(projectId)),
    listPublicProfiles(),
  ]);

  return (
    <ProjectDetailClient
      projectId={projectId}
      initialSnapshot={initialSnapshot}
      initialProgress={initialProgress}
      initialProfiles={{ profiles }}
      initialCards={(() => {
        const cardResult = listProjectCards(projectId);
        return {
          candidateCount: cardResult.candidateCount,
          cards: cardResult.cards.map((card) => ({
            id: card.id,
            cardType: card.cardType,
            name: card.name,
            status: card.status,
          })),
        };
      })()}
    />
  );
}
