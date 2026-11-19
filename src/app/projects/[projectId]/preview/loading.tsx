import { LoadingSkeleton } from "@/components/loading-skeleton";

export default function PreviewLoading() {
  return (
    <main
      className="mx-auto min-h-screen max-w-[1024px] px-6 py-10"
      role="status"
      aria-label="正在加载预览"
    >
      <LoadingSkeleton variant="card" />
      <div className="mt-6">
        <LoadingSkeleton variant="text" />
      </div>
      <div className="mt-6">
        <LoadingSkeleton variant="card" count={2} />
      </div>
    </main>
  );
}
