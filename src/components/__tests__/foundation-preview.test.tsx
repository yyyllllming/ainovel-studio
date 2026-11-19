import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { FoundationPreview } from "@/components/foundation/foundation-preview";
import { renderWithProviders } from "@/test/test-utils";

const previewActionProps = {
  structuredSuggestions: null,
  coreDrift: false,
  structuredSuggestionsMutationPending: false,
  onGenerateStructuredSuggestions: () => {},
  onRefreshStructuredSuggestions: () => {},
  onApplyStructuredSuggestion: () => {},
  onDismissStructuredSuggestion: () => {},
} as const;

describe("FoundationPreview", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("explains that transcript characters are extracted during formal foundation generation when no structured character draft exists", () => {
    renderWithProviders(
      <FoundationPreview
        draft={{
          premise: "",
          mainline: "",
          storyHook: "",
          desiredTone: "default",
          characterIdeas: [],
          worldviewIdeas: [],
          relationshipIdeas: [],
          unresolvedQuestions: [],
          styleReferences: [],
          styleSamples: [],
          styleManualGuidance: "",
          styleAvoidances: "",
          styleSteeringCard: "",
        }}
        derivedFoundation={null}
        derivedFoundationMeta={null}
        foundation={null}
        foundationLocked={false}
        readyToGenerate={false}
        draftProgressNode={null}
        {...previewActionProps}
      />,
    );

    expect(screen.getByText("当前没有结构化角色草案；整理正式设定时会从对话中补抽实名角色。")).toBeInTheDocument();
  });

  it("does not emit duplicate-key warnings when recentRejections contains repeated dirty entries", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    renderWithProviders(
      <FoundationPreview
        draft={{
          premise: "",
          mainline: "",
          storyHook: "",
          desiredTone: "default",
          characterIdeas: [],
          worldviewIdeas: [],
          relationshipIdeas: [],
          unresolvedQuestions: [],
          styleReferences: [],
          styleSamples: [],
          styleManualGuidance: "",
          styleAvoidances: "",
          styleSteeringCard: "",
        }}
        derivedFoundation={{
          premise: "测试 premise",
          styleCard: "风格卡",
          characters: [],
          worldview: [],
          relationships: [],
        }}
        derivedFoundationMeta={null}
        foundation={null}
        foundationLocked={false}
        readyToGenerate={false}
        draftProgressNode={null}
        {...previewActionProps}
        recentRejections={[
          { rawName: "母收养", reason: "命中称谓/动作/半句黑名单" },
          { rawName: "母收养", reason: "命中称谓/动作/半句黑名单" },
        ]}
        rejectionStats={{ total: 2 }}
      />,
    );

    expect(screen.getAllByText("母收养")).toHaveLength(2);
    expect(
      consoleError.mock.calls.some((call) => String(call[0]).includes("same key")),
    ).toBe(false);
  });
});
