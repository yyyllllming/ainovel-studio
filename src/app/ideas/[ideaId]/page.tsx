import { IdeaDetailClient } from "@/components/idea-detail-client";
import { getIdeaDetail } from "@/server/services/idea.service";

export default async function IdeaDetailPage({
  params,
}: {
  params: Promise<{ ideaId: string }>;
}) {
  const { ideaId } = await params;
  let initialIdea: Awaited<ReturnType<typeof getIdeaDetail>> | undefined;
  try {
    initialIdea = await getIdeaDetail(ideaId);
  } catch {
    // 想法不存在或读取失败时退回客户端拉取，由 404 / 错误状态处理
    initialIdea = undefined;
  }
  return <IdeaDetailClient ideaId={ideaId} initialIdea={initialIdea} />;
}
