import { ChapterWorkshopClient } from "@/components/chapter-workshop-client";
import { getChapterDetail } from "@/server/services/chapter-query.service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ChapterPage({
  params,
}: {
  params: Promise<{ projectId: string; chapterNo: string }>;
}) {
  const { projectId, chapterNo } = await params;
  const num = Number(chapterNo);
  const chapter = await getChapterDetail(projectId, num, { includeConflicts: true });

  return (
    <ChapterWorkshopClient
      projectId={projectId}
      chapterNo={num}
      initialChapter={chapter}
      initialConflicts={{ conflicts: chapter.conflicts ?? [] }}
    />
  );
}
