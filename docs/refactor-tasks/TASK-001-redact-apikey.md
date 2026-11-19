# TASK-001: 修复 llm-profiles 明文 apiKey 泄漏

## 优先级：P0 安全

## 目标
`GET /api/settings/llm-profiles` 不再返回明文 apiKey。保存时支持"留空不修改"。

## 涉及文件

| 文件 | 操作 |
|---|---|
| `platform/src/server/profiles.ts` | 新增 `getProfilesForClient()` 函数 |
| `platform/src/app/api/settings/llm-profiles/route.ts` | 改为调用 `getProfilesForClient()` |
| `platform/src/app/api/settings/llm-profiles/save/route.ts` | 支持 apiKey 为空时保留原值 |
| `platform/src/components/settings-client.tsx` | 适配新响应结构 |

## 具体操作

### 1. `platform/src/server/profiles.ts`

在 `getProfiles()` 之后新增：

```typescript
export type ClientProfile = Omit<LlmProfile, "apiKey"> & {
  hasApiKey: boolean;
  maskedApiKey: string;
};

function maskApiKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

export async function getProfilesForClient(): Promise<ClientProfile[]> {
  const profiles = await getProfiles();
  return profiles.map(({ apiKey, ...rest }) => ({
    ...rest,
    hasApiKey: !!apiKey,
    maskedApiKey: maskApiKey(apiKey),
  }));
}
```

### 2. `platform/src/server/profiles.ts` — 修改 `upsertProfile()`

在 `upsertProfile` 中，第 109 行附近：
```typescript
apiKey: input.apiKey ?? found?.apiKey ?? "",
```
改为：
```typescript
apiKey: (input.apiKey && input.apiKey.trim()) ? input.apiKey.trim() : (found?.apiKey ?? ""),
```

这样前端传空字符串或不传 apiKey 时，保留原值。

### 3. `platform/src/app/api/settings/llm-profiles/route.ts`

```typescript
import { getProfilesForClient } from "@/server/profiles";
import { jsonError, jsonOk } from "@/server/http";

export async function GET() {
  try {
    const profiles = await getProfilesForClient();
    return jsonOk({ profiles });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "读取模型配置失败", 500);
  }
}
```

### 4. `platform/src/components/settings-client.tsx`

#### 4a. 修改 Profile 接口

```typescript
interface Profile {
  id: string;
  name: string;
  providerId?: string;
  baseUrl: string;
  hasApiKey: boolean;
  maskedApiKey: string;
  defaultModel: string;
  enabled: boolean;
}
```

注意：`apiKey` 字段从接口中移除。

#### 4b. 修改 `loadProfileIntoForm()`（第 149-161 行）

```typescript
function loadProfileIntoForm(profile: Profile & { providerId: string }) {
  setEditingId(profile.id);
  setForm({
    name: profile.name,
    providerId: profile.providerId,
    baseUrl: profile.baseUrl,
    apiKey: "",  // 不再预填明文 key
    defaultModel: profile.defaultModel,
    enabled: profile.enabled,
  });
  setFetchedModels([]);
  setFeedback(`已载入 ${profile.name}。API Key 需要重新输入才会更新，留空则保留原配置。`);
}
```

#### 4c. 修改保存校验 `canSave`（第 94-98 行）

```typescript
const isEditing = editingId !== null;
const canSave =
  form.name.trim().length > 0 &&
  form.baseUrl.trim().length > 0 &&
  (isEditing || form.apiKey.trim().length > 0) &&  // 编辑时允许留空
  form.defaultModel.trim().length > 0;
```

#### 4d. 修改右侧 key 预览（第 513-515 行）

```typescript
<p className="mt-2 text-xs text-[var(--ink-soft)]">
  key 预览：{profile.hasApiKey ? profile.maskedApiKey : "未填写"}
</p>
```

#### 4e. API Key 输入框 placeholder 改为提示留空行为（第 307-318 行）

```typescript
<label className="grid gap-2 text-sm md:col-span-2">
  API Key
  <input
    type="password"
    className="form-input rounded-2xl"
    value={form.apiKey}
    onChange={(event) =>
      setForm((current) => ({ ...current, apiKey: event.target.value }))
    }
    placeholder={editingId ? "留空则保留原 Key，输入新值则替换" : "sk-..."}
  />
</label>
```

## 验证方式

```bash
# 1. 启动开发服务器后
curl http://localhost:3000/api/settings/llm-profiles | jq '.profiles[0]'
# 预期：没有 apiKey 字段，有 hasApiKey 和 maskedApiKey

# 2. 保存时不传 apiKey
curl -X POST http://localhost:3000/api/settings/llm-profiles/save \
  -H "Content-Type: application/json" \
  -d '{"id":"现有profile的id","name":"测试","baseUrl":"https://example.com/v1","defaultModel":"gpt-4"}'
# 预期：保存成功，原 apiKey 不丢失

# 3. 保存时传新 apiKey
curl -X POST http://localhost:3000/api/settings/llm-profiles/save \
  -H "Content-Type: application/json" \
  -d '{"id":"现有profile的id","name":"测试","baseUrl":"https://example.com/v1","apiKey":"sk-newkey","defaultModel":"gpt-4"}'
# 预期：apiKey 被替换

# 4. 运行现有测试
cd platform && npx vitest run
```

## 不允许

- 响应中出现完整 apiKey
- 日志中记录明文 apiKey
- 前端缓存或 localStorage 中存储明文 apiKey
- 为了兼容继续返回明文 key（哪怕带 deprecated 标记）

## 对前端的影响

- 设置页编辑时不再预填旧 key
- "载入编辑" 后 API Key 输入框为空，placeholder 提示"留空则保留"
- 右侧列表显示 `maskedApiKey` 而非 `maskKey(apiKey)`
- 测试和拉取模型功能不受影响（它们走 profileId 或 transient profile）

## 回滚方案

如果需要紧急回滚：将 route.ts 中 `getProfilesForClient` 改回 `getProfiles` 即可恢复旧行为。但这不应该发生——明文 key 是确定性风险。
