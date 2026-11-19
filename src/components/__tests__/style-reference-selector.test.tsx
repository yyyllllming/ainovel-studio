import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { StyleReferenceSelector } from "@/components/foundation/style-reference-selector";
import { renderWithProviders } from "@/test/test-utils";

function buildProps() {
  return {
    projectId: "project-1",
    draft: {
      premise: "山海经异兽冒头。",
      mainline: "主角闯入旧神遗土。",
      storyHook: "第一夜就撞上异兽潮。",
      desiredTone: "default",
      characterIdeas: [],
      worldviewIdeas: [],
      relationshipIdeas: [],
      unresolvedQuestions: [],
      styleReferences: [],
      styleManualGuidance: "",
      styleAvoidances: "",
      styleSteeringCard: "",
      styleDigest: "旧摘要",
    },
    sourceIdea: {
      id: "idea-1",
      title: "洪荒异兽",
      deletedAt: null,
      updatedAt: "2026-04-05T00:00:00.000Z",
      draft: {
        premise: "山海经异兽冒头。",
        mainline: "主角闯入旧神遗土。",
        storyHook: "第一夜就撞上异兽潮。",
        desiredTone: "default",
        characterIdeas: [],
        worldviewIdeas: [],
        relationshipIdeas: [],
        unresolvedQuestions: [],
      },
    },
    authorCards: [
      {
        id: "author-1",
        displayName: "辰东",
        latestVersion: 1,
        versionCount: 1,
        latestConfidence: "high" as const,
        latestCreatedAt: "2026-04-05T00:00:00.000Z",
        createdAt: "2026-04-04T00:00:00.000Z",
        updatedAt: "2026-04-05T00:00:00.000Z",
      },
    ],
    expandedAuthorId: "author-1",
    expandedAuthorDetail: {
      card: {
        id: "author-1",
        displayName: "辰东",
        latestVersion: 1,
        versionCount: 1,
        latestConfidence: "high" as const,
        latestCreatedAt: "2026-04-05T00:00:00.000Z",
        createdAt: "2026-04-04T00:00:00.000Z",
        updatedAt: "2026-04-05T00:00:00.000Z",
      },
      versions: [
        {
          id: "version-1",
          authorCardId: "author-1",
          version: 1,
          styleCard: "作者风格卡",
          styleDigest: "作者摘要",
          confidence: "high" as const,
          sourceWorks: [{ title: "完美世界", author: "辰东" }],
          createdAt: "2026-04-05T00:00:00.000Z",
        },
      ],
      bookCards: [
        {
          id: "book-new",
          authorCardId: "author-1",
          title: "完美世界-辰东",
          authorName: "辰东",
          styleCard: "新版书卡",
          styleDigest: "新摘要",
          confidence: "high" as const,
          wordCount: 120000,
          chapterCount: 80,
          sourceFileName: "完美世界-辰东.txt",
          createdAt: "2026-04-05T10:00:00.000Z",
        },
        {
          id: "book-old",
          authorCardId: "author-1",
          title: "完美世界-辰东",
          authorName: "辰东",
          styleCard: "旧版书卡",
          styleDigest: "旧摘要",
          confidence: "medium" as const,
          wordCount: 118000,
          chapterCount: 78,
          sourceFileName: "完美世界-辰东.txt",
          createdAt: "2026-04-05T09:00:00.000Z",
        },
      ],
      imports: [],
    },
    authorCardDetailLoading: false,
    applyAuthorCardPending: false,
    applyBookCardPending: false,
    activeStyleDigest: "旧摘要",
    onApplyAuthorCard: vi.fn(),
    onApplyBookCard: vi.fn(),
    onToggleAuthorCard: vi.fn(),
    styleQuery: "",
    onStyleQueryChange: vi.fn(),
    onSearch: vi.fn(),
    styleSearchPending: false,
    isStyleStreaming: false,
    styleSourceLabel: null,
    referencePool: [],
    primaryStyleKey: "",
    secondaryStyleKeys: [],
    getReferenceKey: vi.fn(),
    renderReferenceLabel: vi.fn(),
    onSelectPrimary: vi.fn(),
    onToggleSecondary: vi.fn(),
    manualGuidance: "",
    onManualGuidanceChange: vi.fn(),
    avoidances: "",
    onAvoidancesChange: vi.fn(),
    styleSamples: "",
    styleSampleDelimiter: "\n\n---\n\n",
    onStyleSamplesChange: vi.fn(),
    onSave: vi.fn(),
    styleProgressNode: null,
    visibleStyleCard: "",
  };
}

describe("StyleReferenceSelector", () => {
  it("collapses same-source duplicate book cards and marks the applied style", () => {
    renderWithProviders(<StyleReferenceSelector {...buildProps()} />);

    expect(screen.getByText("当前项目已应用：书级风格《完美世界-辰东》")).toBeInTheDocument();
    expect(screen.getByText("旧摘要")).toBeInTheDocument();
    expect(screen.queryByText("新摘要")).not.toBeInTheDocument();
    expect(screen.getByText("同源重复版本已折叠 1 张。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "当前已应用" })).toBeDisabled();
  });
});
