import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/test-utils";
import { ProjectChapterList } from "@/components/project/project-chapter-list";
import { screen } from "@testing-library/react";

describe("ProjectChapterList", () => {
  it("does not mark the current chapter as writing when the run is idle", () => {
    renderWithProviders(
      <ProjectChapterList
        projectId="project-1"
        projectStoryLength="long"
        isRunning={false}
        units={[
          {
            chapterNo: 1,
            hasContent: false,
            hasConflict: false,
            isCurrent: true,
            reviewStatus: null,
          },
        ]}
      />,
    );

    expect(screen.getByText("当前推进位置")).toBeInTheDocument();
    expect(screen.queryByText("写作中")).not.toBeInTheDocument();
    expect(screen.getByText("空闲")).toBeInTheDocument();
  });
});
