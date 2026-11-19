import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { ChapterReviews } from "@/components/chapter/chapter-reviews";
import { renderWithProviders } from "@/test/test-utils";

describe("ChapterReviews", () => {
  it("renders structured issue location and evidence", () => {
    renderWithProviders(
      <ChapterReviews
        reviews={[
          {
            id: "review-1",
            reviewMode: "deep",
            verdict: "rewrite_current",
            confidence: 0.35,
            reason: "跨章确定性审计发现不可由模型通过覆盖的硬问题。",
            fixInstructions: "先修复跨章重复、连续性或稿面完整性问题，再重新审查。",
            createdAt: new Date(0).toISOString(),
            issues: [
              {
                type: "character_reentry_without_bridge",
                location: "章首",
                severity: "major",
                evidence: "沈檀 未经出场动作直接进入当前场景",
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByText("章首")).toBeInTheDocument();
    expect(screen.getByText(/沈檀 未经出场动作直接进入当前场景/)).toBeInTheDocument();
  });
});
