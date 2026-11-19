import { AuthorLibraryClient } from "@/components/author-library-client";
import { getAuthorCardFullDetail, listAuthorCardSummaries } from "@/server/services/author-card.service";

export default function AuthorsPage() {
  const authors = listAuthorCardSummaries();
  const initialSelectedId = authors[0]?.id ?? null;
  const initialAuthorDetail = initialSelectedId ? getAuthorCardFullDetail(initialSelectedId) : null;

  return (
    <AuthorLibraryClient
      initialAuthors={{ authors }}
      initialAuthorDetail={initialAuthorDetail}
      initialSelectedId={initialSelectedId}
    />
  );
}
