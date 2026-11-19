import { LoadingSkeleton } from "@/components/loading-skeleton";

export default function ProjectDetailLoading() {
  return (
    <main
      className="mx-auto grid min-h-screen max-w-[1400px] gap-6 px-6 py-10 lg:grid-cols-[320px_1fr]"
      role="status"
      aria-label="正在加载项目"
    >
      <aside className="flex flex-col gap-4">
        <LoadingSkeleton variant="card" />
        <LoadingSkeleton variant="list" count={4} />
      </aside>
      <section className="flex flex-col gap-6">
        <LoadingSkeleton variant="card" />
        <LoadingSkeleton variant="text" />
        <LoadingSkeleton variant="card" count={2} />
      </section>
    </main>
  );
}
