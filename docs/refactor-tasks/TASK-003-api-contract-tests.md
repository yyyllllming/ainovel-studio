# TASK-003: 建立 API 契约快照测试

## 优先级：P0 基础设施

## 目标
为前端正在消费的核心 API 端点建立响应结构快照测试，确保后续重构不会静默破坏接口。

## 涉及文件

| 文件 | 操作 |
|---|---|
| `platform/src/server/api-contracts.test.ts` | 新建 |
| `platform/vitest.config.ts` 或 `package.json` | 确认 vitest 已配置 |

## 要覆盖的端点

优先覆盖前端高频消费的接口，验证响应结构（字段名 + 类型）：

1. `GET /api/settings/llm-profiles` — 字段不含 apiKey，含 hasApiKey/maskedApiKey
2. `GET /api/projects` — 返回 `{ projects: ProjectRecord[] }`
3. `GET /api/projects/:projectId` — 聚合响应的所有顶层字段存在
4. `GET /api/projects/:projectId/run/progress` — RunProgressView 字段存在
5. `GET /api/projects/:projectId/chapters/:chapterNo` — 聚合响应字段存在
6. `GET /api/ideas` — 返回 `{ ideas: [...] }`
7. `GET /api/authors` — 返回 `{ authors: [...] }`

## 测试策略

不启动完整 Next.js 服务器，直接调用 service 层函数并验证返回结构。如果 service 层不好 mock，可以用 supertest 或直接调用 route handler。

核心是验证**响应的类型结构**，不验证具体数据值：

```typescript
import { describe, it, expect } from "vitest";

// 示例：验证 profiles 响应结构
describe("API 契约: llm-profiles", () => {
  it("GET 响应不应包含明文 apiKey", async () => {
    const { getProfilesForClient } = await import("@/server/profiles");
    const profiles = await getProfilesForClient();
    for (const p of profiles) {
      expect(p).not.toHaveProperty("apiKey");
      expect(p).toHaveProperty("hasApiKey");
      expect(p).toHaveProperty("maskedApiKey");
      expect(typeof p.hasApiKey).toBe("boolean");
    }
  });
});

// 示例：验证项目详情聚合响应结构
describe("API 契约: project detail", () => {
  it("getProjectDetail 应返回所有必需顶层字段", async () => {
    // 需要一个测试项目 fixture
    const requiredFields = [
      "project", "storyContract", "steeringNotes", "resolvedReviewPolicy",
      "assignments", "foundation", "foundationLocked", "foundationWorkshop",
      "runState", "blueprints", "recentReviews", "reviewStates",
      "invalidatedHistory", "conflicts", "logs", "sourceIdea",
      "novelExport", "writtenChapters"
    ];
    // 对 getProjectDetail 返回值验证字段存在性
  });
});
```

## 完成标准

- 至少 7 个核心端点有响应结构断言
- `GET /api/settings/llm-profiles` 有明确的"不含 apiKey"断言
- 所有测试通过
- 后续 TASK 执行完后这些测试仍然通过

## 注意

- 这些测试的目标是**防止意外破坏**，不是验证业务逻辑
- 如果需要数据库 fixture，创建最小化的 test helper
- 测试文件放在 `platform/src/server/` 下，遵循现有 `*.test.ts` 命名
