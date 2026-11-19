import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { IdeaDetailClient } from "@/components/idea-detail-client";
import { renderWithProviders } from "@/test/test-utils";
import { routerPushMock } from "@/test/setup";

const createProjectMutateMock = vi.fn();
const sendMutationMock = vi.fn();

type MockPublicProfile = {
  id: string;
  name: string;
  providerId: string;
  baseUrl: string;
  defaultModel: string;
  enabled: boolean;
  hasApiKey: boolean;
  maskedApiKey: string | null;
};

const usableProfiles: MockPublicProfile[] = [
  {
    id: "profile-1",
    name: "Alpha",
    providerId: "openai",
    baseUrl: "https://alpha.example.com/v1",
    defaultModel: "alpha-chat",
    enabled: true,
    hasApiKey: true,
    maskedApiKey: "sk-a...1234",
  },
  {
    id: "profile-2",
    name: "Beta",
    providerId: "openai",
    baseUrl: "https://beta.example.com/v1",
    defaultModel: "beta-pro",
    enabled: true,
    hasApiKey: true,
    maskedApiKey: "sk-b...5678",
  },
];

let profiles = [...usableProfiles];

vi.mock("../idea/use-idea-queries", () => ({
  useIdeaQueries: () => ({
    ideaQuery: {
      data: {
        idea: {
          id: "idea-1",
          title: "旧想法",
          deletedAt: null,
          createdAt: "2026-04-06T00:00:00.000Z",
          updatedAt: "2026-04-06T00:00:00.000Z",
        },
        state: {
          updatedAt: "2026-04-06T00:00:00.000Z",
          draft: {
            premise: "",
            mainline: "",
            storyHook: "",
            desiredTone: "",
            characterIdeas: [],
            worldviewIdeas: [],
            relationshipIdeas: [],
            unresolvedQuestions: [],
          },
        },
        messages: [],
        projects: [],
      },
    },
    profilesQuery: {
      data: {
        profiles,
      },
      isLoading: false,
    },
    saveTitleMutation: {
      isPending: false,
      mutate: vi.fn(),
    },
    sendMutation: {
      isPending: false,
      mutate: sendMutationMock,
    },
    trashMutation: {
      isPending: false,
      mutate: vi.fn(),
    },
    createProjectMutation: {
      isPending: false,
      mutate: createProjectMutateMock,
    },
  }),
}));

vi.mock("../idea/idea-development", () => ({
  IdeaDevelopment: ({ onCreateProject }: { onCreateProject: () => void }) => (
    <button onClick={onCreateProject}>创建项目</button>
  ),
}));

vi.mock("../idea/idea-insights-sidebar", () => ({
  IdeaInsightsSidebar: () => <div>sidebar</div>,
}));

describe("IdeaDetailClient", () => {
  beforeEach(() => {
    createProjectMutateMock.mockReset();
    sendMutationMock.mockReset();
    profiles = [...usableProfiles];
  });

  it("routes newly created idea projects into the foundation workshop", () => {
    createProjectMutateMock.mockImplementationOnce(
      (_input: unknown, options?: { onSuccess?: (payload: { project: { id: string } }) => void }) => {
        options?.onSuccess?.({ project: { id: "project-from-idea" } });
      },
    );

    renderWithProviders(<IdeaDetailClient ideaId="idea-1" />);

    fireEvent.click(screen.getByRole("button", { name: "创建项目" }));

    expect(routerPushMock).toHaveBeenCalledWith("/projects/project-from-idea?tab=chat");
  });

  it("shows usable profiles in the top selector and sends the selected profileId with workshop messages", async () => {
    profiles = [...usableProfiles];

    renderWithProviders(<IdeaDetailClient ideaId="idea-1" />);

    const profileSelect = screen.getByLabelText("LLM Profile");
    expect(screen.getByRole("option", { name: "Alpha (alpha-chat)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Beta (beta-pro)" })).toBeInTheDocument();

    fireEvent.change(profileSelect, { target: { value: "profile-2" } });
    fireEvent.change(
      screen.getByPlaceholderText("直接补角色、世界规则、冲突画面或一句你现在最想写的设想。"),
      { target: { value: "补一个新设定" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(sendMutationMock).toHaveBeenCalledWith(
        {
          message: "补一个新设定",
          baseUpdatedAt: "2026-04-06T00:00:00.000Z",
          profileId: "profile-2",
          onEvent: expect.any(Function),
        },
        expect.objectContaining({
          onError: expect.any(Function),
        }),
      );
    });
  });

  it("renders streamed assistant deltas while the idea workshop reply is still in progress", async () => {
    sendMutationMock.mockImplementationOnce((
      input: {
        message: string;
        baseUpdatedAt?: string;
        profileId?: string;
        onEvent?: (event: {
          type: "status" | "assistant_delta" | "final" | "error";
          delta?: string;
          replace?: boolean;
        }) => void;
      },
    ) => {
      input.onEvent?.({ type: "assistant_delta", delta: "第一段想法延展，" });
      input.onEvent?.({ type: "assistant_delta", delta: "第二段继续补充。" });
    });

    renderWithProviders(<IdeaDetailClient ideaId="idea-1" />);

    fireEvent.change(
      screen.getByPlaceholderText("直接补角色、世界规则、冲突画面或一句你现在最想写的设想。"),
      { target: { value: "补一个新设定" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText("第一段想法延展，第二段继续补充。")).toBeInTheDocument();
    expect(screen.getByText("补一个新设定")).toBeInTheDocument();
  });

  it("buffers incomplete sentence fragments until a sentence boundary arrives", async () => {
    sendMutationMock.mockImplementationOnce((
      input: {
        onEvent?: (event: {
          type: "status" | "assistant_delta" | "final" | "error";
          delta?: string;
          replace?: boolean;
        }) => void;
      },
    ) => {
      input.onEvent?.({ type: "assistant_delta", delta: "第一句还没写完" });
      queueMicrotask(() => {
        input.onEvent?.({ type: "assistant_delta", delta: "，现在补完。" });
        input.onEvent?.({ type: "final" });
      });
    });

    renderWithProviders(<IdeaDetailClient ideaId="idea-1" />);

    fireEvent.change(
      screen.getByPlaceholderText("直接补角色、世界规则、冲突画面或一句你现在最想写的设想。"),
      { target: { value: "补一个新设定" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(screen.queryByText("第一句还没写完")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("第一句还没写完，现在补完。")).toBeInTheDocument();
    });
  });

  it("warns when there is no usable profile and disables workshop submission", () => {
    profiles = [
      {
        id: "profile-disabled",
        name: "Disabled",
        providerId: "openai",
        baseUrl: "https://disabled.example.com/v1",
        defaultModel: "disabled-model",
        enabled: false,
        hasApiKey: true,
        maskedApiKey: "sk-c...9999",
      },
    ];

    renderWithProviders(<IdeaDetailClient ideaId="idea-1" />);

    expect(screen.getByText("请先在设置页启用至少一个带 API Key 和默认模型的 LLM Profile。")).toBeInTheDocument();

    fireEvent.change(
      screen.getByPlaceholderText("直接补角色、世界规则、冲突画面或一句你现在最想写的设想。"),
      { target: { value: "补一个新设定" } },
    );

    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
  });
});
