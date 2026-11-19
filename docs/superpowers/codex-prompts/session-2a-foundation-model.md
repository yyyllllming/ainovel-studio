# Codex Prompt — Session 2A: Foundation 数据模型升级

## 上下文

AINovel Studio（`platform/`）的 Foundation 数据模型太薄：CharacterCard 只有 5 字段（name/role/goal/traits/secrets?），WorldRule 只有 2 字段（name/description）。Writer 拿到的角色信息只有一行摘要，世界规则的激活依赖洪荒题材硬编码正则。

Session 1 已经引入了统一注入引擎，本 Session 扩展 Foundation 数据模型并升级生成 prompt，让 LLM 在创建设定时就产出更丰富的结构化数据。

## 任务

### 1. 扩展 CharacterCard 类型

**修改文件：** `src/server/types/core.ts`

```typescript
export interface CharacterCard {
  name: string;
  role: string;
  goal: string;
  traits: string[];
  secrets?: string[];
  // 新增
  description?: string;        // 2-3句外貌+关键背景
  speechPattern?: string;      // 说话习惯（句式、用词、口头禅）
  triggerKeywords?: string[];   // 注入引擎用的激活关键词
}
```

### 2. 扩展 WorldRule 类型

**修改文件：** `src/server/types/core.ts`

```typescript
export interface WorldRule {
  name: string;
  description: string;
  // 新增
  priority?: "core" | "situational";
  triggerKeywords?: string[];
}
```

### 3. 更新 foundationSchema

**修改文件：** `src/server/services/foundation-generate.service.ts`

在 `foundationSchema` 中为 characters 和 worldview 增加新的 optional 字段：

```typescript
export const foundationSchema = z.object({
  premise: z.string().min(1),
  styleCard: z.string().min(1),
  characters: z.array(z.object({
    name: z.string().min(1),
    role: z.string().min(1),
    goal: z.string().min(1),
    traits: z.array(z.string()).min(1),
    secrets: z.array(z.string()).optional(),
    description: z.string().optional(),
    speechPattern: z.string().optional(),
    triggerKeywords: z.array(z.string()).optional(),
  })),
  worldview: z.array(z.object({
    name: z.string().min(1),
    description: z.string().min(1),
    priority: z.enum(["core", "situational"]).optional(),
    triggerKeywords: z.array(z.string()).optional(),
  })),
  relationships: z.array(z.object({
    source: z.string().min(1),
    target: z.string().min(1),
    label: z.string().min(1),
  })),
});
```

### 4. 升级 generateFoundation 的 LLM prompt

**修改文件：** `src/server/services/foundation-generate.service.ts`

在 `generateFoundation` 函数中，找到构建 LLM messages 的地方。在 system prompt 或 user prompt 的末尾追加以下结构要求：

```
角色输出要求：
- name, role, goal, traits：必填
- description：2-3 句外貌和关键背景，让读者能在脑海中看到这个人
- speechPattern：这个角色独特的说话方式（句式偏好、用词习惯、口头禅），比如"简短陈述句居多，很少反问"
- secrets：至少 1 个隐藏信息
- triggerKeywords：3-5 个文本中会提到该角色时常见的词（别名、绰号、身份关键词）

世界规则输出要求：
- name, description：必填
- priority："core" 表示故事世界的基础法则（每章都相关），"situational" 表示特定场景才相关的规则
- triggerKeywords：3-5 个触发词（在文本中出现这些词时应注入该规则）
```

### 5. 更新 context-entry-collectors.ts 利用新字段

**修改文件：** `src/server/run/context-entry-collectors.ts`

在 `collectCharacterEntries` 中，角色卡的序列化增加新字段：

```typescript
const lines = [`## ${card.name}（${card.role}）`];
lines.push(`目标：${card.goal}`);
lines.push(`特质：${card.traits.join("、")}`);
if (card.description) lines.push(`描述：${card.description}`);
if (card.speechPattern) lines.push(`说话习惯：${card.speechPattern}`);
if (card.secrets?.length) lines.push(`秘密：${card.secrets.join("；")}`);
```

在关键词激活中使用 `card.triggerKeywords`：
```typescript
activation: isRelevant
  ? { mode: "always" }
  : { mode: "keyword", keywords: [card.name, ...(card.triggerKeywords ?? [])] },
```

在 `collectWorldEntries` 中使用 `rule.priority` 和 `rule.triggerKeywords`：
```typescript
const isCore = rule.priority === "core";
activation: isCore
  ? { mode: "always" }
  : { mode: "keyword", keywords: rule.triggerKeywords ?? [rule.name] },
```

### 6. 清理 foundation-enrichment.ts 的洪荒硬编码

**修改文件：** `src/server/foundation/foundation-enrichment.ts`

找到 `assessFoundationCoverage` 函数中检测"缺少核心机制关键词"的部分（包含 `灵纹|血脉|天赋|反噬|代价` 正则）和"缺少开篇区域锚点"（包含 `山|林|谷|部族|村` 正则），删除或替换为通用逻辑：
- 改为：`worldview 中没有 priority="core" 的规则 → +2`
- 改为：`characters 中超过一半没有 description → +1`

找到 `buildFallbackFoundationExpansion` 中的洪荒预设池（灵纹偷学、偷学代价、气息追猎、预设角色名池等），改为通用 fallback：
- 角色 fallback：用通用名（"对手"/"导师"/"盟友"）+ 从 premise 推断的 role
- 世界规则 fallback：从 genre + premise 推断 2-3 条通用规则

## 验证命令

```bash
cd platform
pnpm typecheck
pnpm test
pnpm build

# 确认洪荒硬编码已清除（在 foundation-enrichment.ts 中）
grep -rn "灵纹\|血脉\|天赋\|反噬\|代价\|追猎\|部族\|禁区\|兽道" src/server/foundation/ --include="*.ts"
# 预期为空
```

## 约束

- 所有新字段必须 optional（兼容老项目数据）
- 不需要 DB 迁移（Foundation 存为 JSON 列）
- 不改 test 文件中的 fixture 数据（除非类型变更导致编译错误，此时最小修改）
- 不改 prompts/ 目录（Session 2B 负责）
