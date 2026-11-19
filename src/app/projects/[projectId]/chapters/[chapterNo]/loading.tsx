import { LoadingSkeleton } from "@/components/loading-skeleton";

export default function ChapterLoading() {
  return (
    <main
      className="mx-auto grid min-h-screen max-w-[1280px] gap-6 px-6 py-10 lg:grid-cols-[260px_1fr]"
      role="status"
      aria-label="正在加载章节"
    >
      <aside className="flex flex-col gap-4">
        <LoadingSkeleton variant="text" />
        <LoadingSkeleton variant="list" count={3} />
      </aside>
      <section className="flex flex-col gap-6">
        <LoadingSkeleton variant="card" />
        <LoadingSkeleton variant="text" />
        <LoadingSkeleton variant="card" />
      </section>
    </main>
  );
}
