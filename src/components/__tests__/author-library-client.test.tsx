import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { AuthorLibraryClient } from "@/components/author-library-client";
import { renderWithProviders } from "@/test/test-utils";

const initialAuthors = {
  authors: [
    {
      id: "author-1",
      displayName: "沈知白",
      latestVersion: 1,
      versionCount: 1,
      latestConfidence: "high" as const,
      latestCreatedAt: "2026-04-04T00:00:00.000Z",
      createdAt: "2026-04-03T00:00:00.000Z",
      updatedAt: "2026-04-04T00:00:00.000Z",
    },
  ],
};

const initialAuthorDetail = {
  card: initialAuthors.authors[0]!,
  versions: [
    {
      id: "version-1",
      authorCardId: "author-1",
      version: 1,
      styleCard: "作者风格卡正文",
      styleDigest: "作者风格摘要",
      confidence: "high" as const,
      sourceWorks: [
        { title: "长夜潮声", author: "沈知白" },
        { title: "雾中山门", author: "沈知白" },
      ],
      createdAt: "2026-04-04T00:00:00.000Z",
    },
  ],
  bookCards: [
    {
      id: "book-1",
      authorCardId: "author-1",
      title: "长夜潮声",
      authorName: "沈知白",
      styleCard: "书级风格卡 A",
      styleDigest: "摘要 A",
      confidence: "high" as const,
      wordCount: 120000,
      chapterCount: 80,
      createdAt: "2026-04-04T00:00:00.000Z",
    },
    {
      id: "book-2",
      authorCardId: "author-1",
      title: "雾中山门",
      authorName: "沈知白",
      styleCard: "书级风格卡 B",
      styleDigest: "摘要 B",
      confidence: "medium" as const,
      wordCount: 95000,
      chapterCount: 64,
      createdAt: "2026-04-04T00:00:00.000Z",
    },
  ],
  imports: [
    {
      id: "import-1",
      authorCardId: "author-1",
      title: "长夜潮声",
      authorName: "沈知白",
      originalFileName: "长夜潮声.txt",
      mediaType: "text/plain",
      wordCount: 120000,
      encoding: "utf8",
      confidence: "high" as const,
      chapterCount: 80,
      sourceKind: "plain_import" as const,
      bookCardStatus: "idle" as const,
      lastGenerationError: null,
      createdAt: "2026-04-04T00:00:00.000Z",
    },
  ],
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

describe("AuthorLibraryClient", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url === "/api/settings/llm-profiles") {
        return jsonResponse({
          profiles: [
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
            {
              id: "profile-3",
              name: "Disabled",
              providerId: "openai",
              baseUrl: "https://disabled.example.com/v1",
              defaultModel: "disabled-model",
              enabled: false,
              hasApiKey: true,
              maskedApiKey: "sk-c...9999",
            },
            {
              id: "profile-4",
              name: "NoKey",
              providerId: "openai",
              baseUrl: "https://nokey.example.com/v1",
              defaultModel: "nokey-model",
              enabled: true,
              hasApiKey: false,
              maskedApiKey: null,
            },
            {
              id: "profile-5",
              name: "NoModel",
              providerId: "openai",
              baseUrl: "https://nomodel.example.com/v1",
              defaultModel: "",
              enabled: true,
              hasApiKey: true,
              maskedApiKey: "sk-d...0000",
            },
          ],
        });
      }

      if (url === "/api/authors") {
        return jsonResponse(initialAuthors);
      }

      if (url === "/api/authors/author-1") {
        return jsonResponse(initialAuthorDetail);
      }

      if (url === "/api/authors/author-1/book-cards") {
        return jsonResponse({ bookCards: initialAuthorDetail.bookCards });
      }

      if (url === "/api/authors/author-1/merge") {
        return jsonResponse({ version: initialAuthorDetail.versions[0] });
      }

      return jsonResponse({ error: `Unhandled fetch: ${url} ${init?.method ?? "GET"}` }, 500);
    });

    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("filters usable profiles, defaults to the first option, and sends profileId for generate and merge", async () => {
    renderWithProviders(
      <AuthorLibraryClient
        initialAuthors={initialAuthors}
        initialAuthorDetail={initialAuthorDetail}
        initialSelectedId="author-1"
      />,
    );

    const profileSelect = await screen.findByLabelText("LLM Profile");
    expect(await screen.findByRole("option", { name: "Alpha (alpha-chat)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Beta (beta-pro)" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Disabled (disabled-model)" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "NoKey (nokey-model)" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "NoModel ()" })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(profileSelect).toHaveValue("profile-1");
    });

    fireEvent.change(profileSelect, { target: { value: "profile-2" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "选中 1 份文本 → 生成书级风格卡" }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => url === "/api/authors/author-1/book-cards");
      expect(call).toBeTruthy();
      expect(call?.[1]?.method).toBe("POST");
      expect(call?.[1]?.body).toBe(JSON.stringify({
        importIds: ["import-1"],
        profileId: "profile-2",
      }));
    });

    fireEvent.click(screen.getByRole("button", { name: "重新合并" }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => url === "/api/authors/author-1/merge");
      expect(call).toBeTruthy();
      expect(call?.[1]?.method).toBe("POST");
      expect(call?.[1]?.body).toBe(JSON.stringify({
        profileId: "profile-2",
      }));
    });
  });
});
