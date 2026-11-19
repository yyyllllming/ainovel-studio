import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { SettingsClient } from "@/components/settings-client";
import { renderWithProviders } from "@/test/test-utils";

// Mock useConfirm hook
const confirmMock = vi.fn<() => Promise<boolean>>();
vi.mock("@/components/confirm-dialog", () => ({
  useConfirm: () => ({ confirm: confirmMock }),
  ConfirmDialogProvider: ({ children }: { children: React.ReactNode }) => children,
}));

type ProfileFixture = {
  id: string;
  name: string;
  providerId: string;
  baseUrl: string;
  defaultModel: string;
  enabled: boolean;
  hasApiKey: boolean;
  maskedApiKey: string | null;
};

const seedProfiles: ProfileFixture[] = [
  {
    id: "profile-1",
    name: "Primary Relay",
    providerId: "custom",
    baseUrl: "https://relay.example.com/v1",
    defaultModel: "writer-1",
    enabled: true,
    hasApiKey: true,
    maskedApiKey: "sk-***7890",
  },
  {
    id: "profile-2",
    name: "No Key Profile",
    providerId: "openai",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-5.4-mini",
    enabled: false,
    hasApiKey: false,
    maskedApiKey: null,
  },
];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

describe("SettingsClient", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    let profiles = seedProfiles.map((profile) => ({ ...profile }));

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method ?? "GET";

      if (url === "/api/settings/llm-profiles" && method === "GET") {
        return jsonResponse({ profiles });
      }

      if (url === "/api/settings/llm-profiles/save" && method === "POST") {
        const payload = JSON.parse(String(init?.body ?? "{}")) as {
          id?: string;
          name: string;
          providerId: string;
          baseUrl: string;
          defaultModel: string;
          enabled: boolean;
          apiKey: string;
        };
        const existing = profiles.find((profile) => profile.id === payload.id);
        const nextProfile = {
          id: payload.id ?? "created-profile",
          name: payload.name,
          providerId: payload.providerId,
          baseUrl: payload.baseUrl,
          defaultModel: payload.defaultModel,
          enabled: payload.enabled,
          hasApiKey: existing?.hasApiKey ?? payload.apiKey.trim().length > 0,
          maskedApiKey:
            existing?.maskedApiKey ?? (payload.apiKey.trim() ? "sk-new...1234" : null),
        };

        profiles = existing
          ? profiles.map((profile) => (profile.id === nextProfile.id ? nextProfile : profile))
          : [...profiles, nextProfile];

        return jsonResponse({ profile: nextProfile });
      }

      if (url === "/api/settings/llm-profiles/test" && method === "POST") {
        const payload = JSON.parse(String(init?.body ?? "{}")) as {
          profileId?: string;
          profile?: unknown;
          model?: string;
        };

        return jsonResponse({
          preview: "pong",
          model: payload.model ?? "writer-1",
          profileId: payload.profileId ?? null,
          profile: payload.profile ?? null,
        });
      }

      if (url === "/api/settings/llm-profiles/fetch-models" && method === "POST") {
        const payload = JSON.parse(String(init?.body ?? "{}")) as {
          profileId?: string;
          profile?: unknown;
        };

        return jsonResponse({
          models: ["writer-1", "writer-2"],
          profileId: payload.profileId ?? null,
          profile: payload.profile ?? null,
        });
      }

      if (url === "/api/settings/llm-profiles/profile-1" && method === "DELETE") {
        profiles = profiles.filter((profile) => profile.id !== "profile-1");
        return jsonResponse({ ok: true, deletedId: "profile-1" });
      }

      return jsonResponse({ error: `Unhandled fetch: ${url} ${method}` }, 500);
    });

    confirmMock.mockResolvedValue(true);
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows masked key state, accessible icon actions, and disables quick toggle while the profile is being edited", async () => {
    renderWithProviders(
      <SettingsClient
        initialProfiles={{
          profiles: seedProfiles,
        }}
      />,
    );

    expect(screen.getByLabelText("API Key")).toHaveAttribute("type", "password");
    expect(screen.getByText("key 状态：sk-***7890")).toBeInTheDocument();
    const primaryRelayCard = screen.getByRole("heading", { name: "Primary Relay" }).closest("div.workspace-item") as HTMLElement | null;

    expect(primaryRelayCard).not.toBeNull();
    expect(screen.getByRole("button", { name: "编辑 Profile Primary Relay" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除 Profile Primary Relay" })).toBeInTheDocument();
    expect(within(primaryRelayCard!).queryByRole("button", { name: "测试连接" })).not.toBeInTheDocument();
    expect(within(primaryRelayCard!).queryByRole("button", { name: "拉取模型" })).not.toBeInTheDocument();
    expect(within(primaryRelayCard!).queryByText("官方文档")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "编辑 Profile Primary Relay" }));

    expect(await screen.findByText("当前已保存：sk-***7890。留空则保持不变。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "已启用 Primary Relay" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消编辑" })).toBeInTheDocument();
  });

  it("confirms before delete, calls DELETE, and resets the form when the edited profile is removed", async () => {
    renderWithProviders(
      <SettingsClient
        initialProfiles={{
          profiles: seedProfiles,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "编辑 Profile Primary Relay" }));
    fireEvent.click(screen.getByRole("button", { name: "删除 Profile Primary Relay" }));

    await waitFor(() => {
      expect(confirmMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining("删除 Profile「Primary Relay」"),
        })
      );
    });

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) => url === "/api/settings/llm-profiles/profile-1" && init?.method === "DELETE",
      );
      expect(call).toBeTruthy();
    });

    expect(await screen.findByText("Profile 已删除。")).toBeInTheDocument();
    expect(screen.getByLabelText("Profile 名称")).toHaveValue("");
  });

  it("keeps test and fetch actions available for an edited profile that already has a saved API key", async () => {
    renderWithProviders(
      <SettingsClient
        initialProfiles={{
          profiles: seedProfiles,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "编辑 Profile Primary Relay" }));

    const testButton = screen.getByRole("button", { name: "测试" });
    const fetchModelsButton = screen.getByRole("button", { name: "拉取模型" });

    expect(testButton).toBeEnabled();
    expect(fetchModelsButton).toBeEnabled();

    fireEvent.click(testButton);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) => url === "/api/settings/llm-profiles/test" && init?.method === "POST",
      );
      expect(call).toBeTruthy();
      const body = JSON.parse(String(call?.[1]?.body ?? "{}")) as {
        profileId?: string;
        profile?: unknown;
        model?: string;
      };
      expect(body.profileId).toBe("profile-1");
      expect(body.profile).toBeUndefined();
      expect(body.model).toBe("writer-1");
    });

    fireEvent.click(fetchModelsButton);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) => url === "/api/settings/llm-profiles/fetch-models" && init?.method === "POST",
      );
      expect(call).toBeTruthy();
      const body = JSON.parse(String(call?.[1]?.body ?? "{}")) as {
        profileId?: string;
        profile?: unknown;
      };
      expect(body.profileId).toBe("profile-1");
      expect(body.profile).toBeUndefined();
    });
  });

  it("fills the model chips after fetching models for an edited profile that reuses its stored key", async () => {
    renderWithProviders(
      <SettingsClient
        initialProfiles={{
          profiles: seedProfiles,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "编辑 Profile Primary Relay" }));
    fireEvent.click(screen.getByRole("button", { name: "拉取模型" }));

    // profileId 路径（沿用已存 Key）也要把拉取结果写进可点击的候选 chips。
    expect(await screen.findByRole("button", { name: "writer-2" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "writer-2" }));
    expect(screen.getByLabelText("默认模型")).toHaveValue("writer-2");
  });

  it("uses the save endpoint for quick toggles and blocks enabling profiles without an API key", async () => {
    renderWithProviders(
      <SettingsClient
        initialProfiles={{
          profiles: seedProfiles,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "已启用 Primary Relay" }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) => url === "/api/settings/llm-profiles/save" && init?.method === "POST",
      );
      expect(call).toBeTruthy();
      const body = JSON.parse(String(call?.[1]?.body ?? "{}")) as {
        id?: string;
        enabled?: boolean;
        apiKey?: string;
      };
      expect(body.id).toBe("profile-1");
      expect(body.enabled).toBe(false);
      expect(body.apiKey).toBe("");
    });

    expect(await screen.findByText("已停用 Primary Relay。")).toBeInTheDocument();

    const saveCallsAfterDisable = fetchMock.mock.calls.filter(
      ([url, init]) => url === "/api/settings/llm-profiles/save" && init?.method === "POST",
    ).length;

    fireEvent.click(screen.getByRole("button", { name: "已停用 No Key Profile" }));

    expect(await screen.findByText("该 Profile 尚未配置 API Key，无法启用。")).toBeInTheDocument();

    const saveCallsAfterBlockedEnable = fetchMock.mock.calls.filter(
      ([url, init]) => url === "/api/settings/llm-profiles/save" && init?.method === "POST",
    ).length;

    expect(saveCallsAfterBlockedEnable).toBe(saveCallsAfterDisable);
  });
});
