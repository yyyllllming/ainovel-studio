import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/test-utils";
import { RunControlPanel } from "@/components/project/run-control-panel";
import { screen } from "@testing-library/react";

describe("RunControlPanel", () => {
  it("renders the reset-to-foundation-workshop action and triggers its callback", async () => {
    const onResetToFoundationWorkshop = vi.fn();

    renderWithProviders(
      <RunControlPanel
        projectId="project-1"
        activeTabLabel="设定工坊"
        project={{
          id: "project-1",
          title: "雾港夜巡",
          genre: "悬疑",
          style: "default",
          targetChapters: 12,
          premise: "夜禁失效后，港城开始出现会说话的雾。",
          seriesMode: "standalone",
          seriesTitle: null,
          seriesIndex: null,
          storyLength: "long",
          narrativePerson: "third",
          chapterPlanningMode: "fixed",
          paceProfile: "medium",
          completionCriteria: "主线闭环",
          chapterBudgetMin: 10,
          chapterBudgetTarget: 12,
          chapterBudgetMax: 14,
          hardChapterCap: 12,
          hasVolumes: false,
          plannedVolumes: null,
          sourceIdeaId: null,
          status: "foundation_locked",
          updatedAt: "2026-04-01T00:00:00.000Z",
        }}
        progress={{
          running: false,
          stage: "idle",
          currentChapter: 1,
          totalChapters: 12,
          retryCount: 0,
          confidence: 0,
          desiredState: "idle",
          wordCount: 0,
          logs: [],
        }}
        currentVolumeLabel="未进入分卷"
        forecastLabel="固定 12 章"
        completionPercent={0}
        activeSteeringNotes={[]}
        invalidatedHistory={[]}
        latestLogs={[]}
        cardStats={{ total: 0, confirmed: 0, character: 0, world: 0 }}
        foundationStatusLabel="已锁定"
        coreDrift={false}
        blockingReason={null}
        conflictCount={0}
        controlStateLabel="空闲"
        lastActiveStageLabel="暂无"
        heartbeatLabel="暂无"
        canStartRun
        isRunning={false}
        isStopping={false}
        isStopped={false}
        isPaused={false}
        isInterrupted={false}
        isCompleted={false}
        hasWrittenChapters
        nextHint="下一步可以继续。"
        manuscriptMaxChapter={12}
        deleteStartChapter={1}
        deleteEndChapter={12}
        simpleMutationPending={false}
        steeringScope="next_arc"
        steeringInstruction=""
        effectiveNarrativePerson="third"
        saveNarrativePersonPending={false}
        steeringPending={false}
        novelExport={{ exists: false, status: "pending" }}
        onClose={() => {}}
        onTriggerPrimaryRun={() => {}}
        onPauseRun={() => {}}
        onStopRun={() => {}}
        onDeleteStartChange={() => {}}
        onDeleteEndChange={() => {}}
        onDeleteRange={() => {}}
        onSteeringScopeChange={() => {}}
        onSteeringInstructionChange={() => {}}
        onSaveSteering={() => {}}
        onNarrativePersonChange={() => {}}
        onSaveNarrativePerson={() => {}}
        onResetToFoundationWorkshop={onResetToFoundationWorkshop}
        onDeleteProject={() => {}}
      />,
    );

    const button = screen.getByRole("button", { name: "重置到设定工坊" });
    expect(button).toBeInTheDocument();
    button.click();
    expect(onResetToFoundationWorkshop).toHaveBeenCalledTimes(1);
  });
});
