/**
 * ChapterReviews — 审核记录面板
 * 从 chapter-workshop-client.tsx 提取
 */

import { StatusBadge } from "../status-badge";

interface ReviewIssue {
  type: string;
  location: string;
  severity: "minor" | "major";
  evidence?: string;
}

interface Review {
  id: string;
  reviewMode?: "quick" | "deep";
  verdict: string;
  confidence: number;
  reason: string;
  fixInstructions: string;
  createdAt: string;
  issues?: ReviewIssue[];
}

interface ChapterReviewsProps {
  reviews: Review[];
}

export function ChapterReviews({ reviews }: ChapterReviewsProps) {
  if (!reviews.length) {
    return <p className="text-sm text-[var(--ink-soft)]">还没有审稿记录。</p>;
  }

  return (
    <div className="grid gap-3">
      {reviews.map((review) => (
        <div key={review.id} className="workspace-item active px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <StatusBadge status={review.verdict} />
            <p className="text-xs text-[var(--ink-soft)]">
              {review.reviewMode === "quick" ? "quick" : "deep"} · confidence={review.confidence.toFixed(2)}
            </p>
          </div>
          <p className="mt-3 text-sm leading-6 text-[var(--ink-soft)]">{review.reason}</p>
          {review.issues?.length ? (
            <ul className="mt-2 grid gap-1 text-sm text-[var(--ink-soft)]">
              {review.issues.map((issue, index) => (
                <li key={`${issue.type}:${issue.location}:${index}`}>
                  <span className="font-medium text-[var(--ink)]">{issue.location}</span>
                  {issue.evidence ? ` · ${issue.evidence}` : ` · ${issue.type}`}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-2 text-sm text-[var(--ink-soft)]">返工建议：{review.fixInstructions}</p>
        </div>
      ))}
    </div>
  );
}
