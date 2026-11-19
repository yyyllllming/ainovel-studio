import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  FOUNDATION_WORKSHOP_DISCARD_TOOLTIP,
  FOUNDATION_WORKSHOP_RECOVERY_BANNER_TEXT,
} from "@/components/foundation/use-foundation-workshop-controller";
import { WorkshopConversation } from "@/components/foundation/workshop-conversation";

describe("WorkshopConversation", () => {
  it("renders the recovery banner and discard-once tooltip without disabling submit", () => {
    const onToggleResumeMode = vi.fn();

    render(
      <WorkshopConversation
        displayedMessages={[]}
        message="继续完善主角代价"
        foundationLocked={false}
        coreDrift={false}
        blockingReason={null}
        isWorkshopStreaming={false}
        workshopProgress={null}
        workshopProgressNode={null}
        hasPendingMessage
        readinessHint=""
        nextFocus={null}
        foundationMutationPending={false}
        foundationLockedMutationPending={false}
        canGenerateFoundation={false}
        foundationExists={false}
        onMessageChange={vi.fn()}
        onSubmit={vi.fn()}
        onGenerateFoundation={vi.fn()}
        onLockFoundation={vi.fn()}
        onToggleResumeMode={onToggleResumeMode}
        resumeBanner={{
          text: FOUNDATION_WORKSHOP_RECOVERY_BANNER_TEXT,
          toggleLabel: "改为丢弃中断片段",
          tooltip: FOUNDATION_WORKSHOP_DISCARD_TOOLTIP,
        }}
        messageListRef={{ current: null }}
        messagesEndRef={{ current: null }}
      />,
    );

    expect(screen.getByText(FOUNDATION_WORKSHOP_RECOVERY_BANNER_TEXT)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交更新" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "改为丢弃中断片段" })).toBeInTheDocument();
    expect(screen.getByLabelText("丢弃模式说明")).toHaveAttribute("title", FOUNDATION_WORKSHOP_DISCARD_TOOLTIP);

    fireEvent.click(screen.getByRole("button", { name: "改为丢弃中断片段" }));
    expect(onToggleResumeMode).toHaveBeenCalledTimes(1);
  });

  it("keeps the workshop editable when the locked foundation has core drift", () => {
    render(
      <WorkshopConversation
        displayedMessages={[]}
        message="把第一章改成先写身世与宏大世界感"
        foundationLocked
        coreDrift
        blockingReason="检测到设定工坊中的核心事实尚未整理为正式设定，请先整理正式设定后再开始自动写作。"
        isWorkshopStreaming={false}
        workshopProgress={null}
        workshopProgressNode={null}
        hasPendingMessage={false}
        readinessHint=""
        nextFocus={null}
        foundationMutationPending={false}
        foundationLockedMutationPending={false}
        canGenerateFoundation
        foundationExists
        onMessageChange={vi.fn()}
        onSubmit={vi.fn()}
        onGenerateFoundation={vi.fn()}
        onLockFoundation={vi.fn()}
        onToggleResumeMode={vi.fn()}
        resumeBanner={null}
        messageListRef={{ current: null }}
        messagesEndRef={{ current: null }}
      />,
    );

    expect(screen.getByRole("textbox")).toBeEnabled();
    expect(screen.getByRole("button", { name: "提交更新" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "重新整理正式设定" })).toBeEnabled();
    expect(screen.getByText("检测到设定工坊中的核心事实尚未整理为正式设定，请先整理正式设定后再开始自动写作。"))
      .toBeInTheDocument();
  });
});
