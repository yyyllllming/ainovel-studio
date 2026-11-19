# Codex Prompt — Session S3: PROSE 迭代收敛 + 数据通路 + 全链路验证

## 上下文

AINovel Studio（`platform/`）已完成：
- Session S1：确定性文体指纹 + 采样去洪荒化 + 数量提升
- Session S2：Map-Reduce LLM 风格分析 + 作者合并升级

本 Session 完成最后收尾：
1. PROSE 迭代收敛（可选高级层，验证 StyleProfile 的有效性）
2. Fingerprint 持久化（数据库存储，通过 author-card.service 传递）
3. 全链路验证

## 任务

### 1. PROSE 迭代收敛模块

**新建文件：** `src/server/style/style-convergence.ts`

**先读以下文件了解依赖：**
- `src/server/style/style-fingerprint.ts` — `computeStyleFingerprint` 函数和 `StyleFingerprint` 类型
- `src/server/style/style-steering.ts` — `formatStyleProfileForStage` 函数、`StyleProfile` 类型
- `src/server/style/style-snapshot.ts` — `StyleGenerationImport`、`StyleExcerpt`
- `prompts/writer.md` — Writer 的系统提示词

```typescript
import type { StyleProfile, StyleExcerpt } from "../types.ts";
import type { StyleFingerprint } from "./style-fingerprint.ts";
import { computeStyleFingerprint } from "./style-fingerprint.ts";
import { formatStyleProfileForStage } from "./style-steering.ts";
import type { ChatMessage } from "../llm.ts";

export interface ConvergenceResult {
  refinedProfile: StyleProfile;
  iterations: number;
  convergenceScore: number;   // 0-1, 越高越收敛
  divergences: DimensionDivergence[];
}

interface DimensionDivergence {
  dimension: string;           // 如 "sentenceLength.mean"
  referenceValue: number;
  generatedValue: number;
  deviation: number;           // 归一化偏差 0-1
}

export async function iterativeStyleConvergence(input: {
  initialProfile: StyleProfile;
  referenceFingerprint: StyleFingerprint;
  referenceExcerpts: StyleExcerpt[];
  maxIterations?: number;
  writerSystemPrompt: string;
  llmCall: (messages: ChatMessage[]) => Promise<string>;
}): Promise<ConvergenceResult> {
  const maxIter = input.maxIterations ?? 2;
  let currentProfile = input.initialProfile;
  let bestScore = 0;
  let lastDivergences: DimensionDivergence[] = [];

  for (let iter = 0; iter < maxIter; iter++) {
    // 1. 用当前 profile 生成测试文本
    const testText = await generateTestPassage({
      profile: currentProfile,
      referenceExcerpts: input.referenceExcerpts.slice(0, 3),
      writerSystemPrompt: input.writerSystemPrompt,
      llmCall: input.llmCall,
    });

    // 2. 对生成文本计算 fingerprint
    const generatedFp = computeStyleFingerprint(testText, []);

    // 3. 计算各维度偏差
    const divergences = computeDivergences(input.referenceFingerprint, generatedFp);
    lastDivergences = divergences;

    // 4. 计算收敛分数
    const convergenceScore = 1 - (divergences.reduce((sum, d) => sum + d.deviation, 0) / Math.max(1, divergences.length));
    bestScore = Math.max(bestScore, convergenceScore);

    // 5. 如果已足够收敛（>0.75），停止迭代
    if (convergenceScore >= 0.75) {
      return { refinedProfile: currentProfile, iterations: iter + 1, convergenceScore, divergences };
    }

    // 6. 找出偏差最大的维度，要求 LLM 精炼
    const worstDimensions = divergences
      .filter(d => d.deviation > 0.2)
      .sort((a, b) => b.deviation - a.deviation)
      .slice(0, 3);

    if (!worstDimensions.length) {
      return { refinedProfile: currentProfile, iterations: iter + 1, convergenceScore, divergences };
    }

    currentProfile = await refineProfileForDivergences({
      profile: currentProfile,
      divergences: worstDimensions,
      llmCall: input.llmCall,
    });
  }

  return {
    refinedProfile: currentProfile,
    iterations: maxIter,
    convergenceScore: bestScore,
    divergences: lastDivergences,
  };
}
```

**辅助函数：**

```typescript
async function generateTestPassage(input: {
  profile: StyleProfile;
  referenceExcerpts: StyleExcerpt[];
  writerSystemPrompt: string;
  llmCall: (messages: ChatMessage[]) => Promise<string>;
}): Promise<string> {
  const styleText = formatStyleProfileForStage(input.profile, "writer");
  const exemplarContext = input.referenceExcerpts
    .map(e => `> ${e.content.slice(0, 200)}`)
    .join("\n\n");

  const systemPrompt = [
    input.writerSystemPrompt,
    "",
    "--- 风格锚点 ---",
    styleText,
  ].join("\n");

  const userPrompt = [
    "请以下面的风格范本为参考，写一段 400-600 字的小说片段。",
    "题材不限，但必须包含：一段叙述、一段对话、一个情绪转折。",
    "",
    "风格范本：",
    exemplarContext,
    "",
    "请直接输出正文，不要加标题或解释。",
  ].join("\n");

  try {
    return await input.llmCall([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);
  } catch {
    return "";
  }
}

function computeDivergences(
  reference: StyleFingerprint,
  generated: StyleFingerprint,
): DimensionDivergence[] {
  const divergences: DimensionDivergence[] = [];
  const safe = (ref: number, gen: number) => Math.abs(ref - gen) / Math.max(1, Math.abs(ref));

  divergences.push({
    dimension: "sentenceLength.mean",
    referenceValue: reference.sentenceLength.mean,
    generatedValue: generated.sentenceLength.mean,
    deviation: Math.min(1, safe(reference.sentenceLength.mean, generated.sentenceLength.mean)),
  });
  divergences.push({
    dimension: "paragraphLength.mean",
    referenceValue: reference.paragraphLength.mean,
    generatedValue: generated.paragraphLength.mean,
    deviation: Math.min(1, safe(reference.paragraphLength.mean, generated.paragraphLength.mean)),
  });
  divergences.push({
    dimension: "dialogue.overallRatio",
    referenceValue: reference.dialogue.overallRatio,
    generatedValue: generated.dialogue.overallRatio,
    deviation: Math.min(1, Math.abs(reference.dialogue.overallRatio - generated.dialogue.overallRatio) * 3),
  });
  divergences.push({
    dimension: "punctuation.exclamation",
    referenceValue: reference.punctuation.exclamation,
    generatedValue: generated.punctuation.exclamation,
    deviation: Math.min(1, safe(reference.punctuation.exclamation + 0.1, generated.punctuation.exclamation + 0.1)),
  });
  divergences.push({
    dimension: "sentenceLength.shortRatio",
    referenceValue: reference.sentenceLength.shortRatio,
    generatedValue: generated.sentenceLength.shortRatio,
    deviation: Math.min(1, Math.abs(reference.sentenceLength.shortRatio - generated.sentenceLength.shortRatio) * 2),
  });

  return divergences;
}

async function refineProfileForDivergences(input: {
  profile: StyleProfile;
  divergences: DimensionDivergence[];
  llmCall: (messages: ChatMessage[]) => Promise<string>;
}): Promise<StyleProfile> {
  const divergenceDesc = input.divergences.map(d =>
    `${d.dimension}: 参考值=${d.referenceValue.toFixed(2)}, 生成值=${d.generatedValue.toFixed(2)}, 偏差=${(d.deviation * 100).toFixed(0)}%`
  ).join("\n");

  const currentRules = formatStyleProfileForStage(input.profile, "writer");

  const systemPrompt = `你是风格规则校准器。当前的风格规则在 LLM 生成时产生了偏差。
请根据偏差信息调整相关规则字段，使生成结果更接近参考值。
只调整与偏差相关的字段，不要改动其他部分。
输出完整的 StyleProfile JSON。`;

  const userPrompt = [
    "当前风格规则：",
    currentRules,
    "",
    "生成测试后发现的偏差：",
    divergenceDesc,
    "",
    "请调整规则以减小这些偏差。例如：",
    "- 如果句长偏短，加强'避免碎句'的规则",
    "- 如果对白占比偏高，加强叙述段的要求",
    "- 如果感叹号过多，加强'克制标点'的规则",
  ].join("\n");

  try {
    const raw = await input.llmCall([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);
    const parsed = safeParseJson<Record<string, unknown>>(
      raw.replace(/```json?\s*/g, "").replace(/```\s*/g, "").trim(),
    );
    if (!parsed) return input.profile;
    // 需要 import normalizeStyleProfile
    const { normalizeStyleProfile } = await import("./style-steering.ts");
    return normalizeStyleProfile(parsed);
  } catch {
    return input.profile;
  }
}
```

**注意：** `refineProfileForDivergences` 中的 dynamic import 是为了避免循环依赖。如果 Codex 发现有更好的方式组织导入关系，可以自行调整。

### 2. Fingerprint 持久化

#### 2a. 数据库 schema 变更

**修改文件：** `src/server/db/schema.ts`

在 `authorBookCards` 表定义中新增字段：

```typescript
fingerprintJson: text("fingerprint_json").notNull().default("{}"),
```

**运行 drizzle-kit 生成迁移：**
```bash
cd platform
pnpm drizzle-kit generate
```

#### 2b. Repository 层

**修改文件：** `src/server/repositories/author-book-card.repository.ts`

在 `createBookCard` 的参数中增加 `fingerprintJson?: string`。
在 `getBookCard` 的返回中解析 `fingerprintJson`。

#### 2c. Service 层通路

**修改文件：** `src/server/services/author-card.service.ts`

**在 `importTextToAuthorCard` 中：**
- `prepareStyleReferenceImport` 返回的 `fingerprint` 字段需要存储
- 如果 `author_text_imports` 表没有 `fingerprint_json` 列，存到 `excerpts_json` 同级的新列
- 或者作为 excerpts_json 的扩展字段传递

**在 `generateBookCardForAuthor` 中：**
- 从导入记录获取 fingerprint
- 传递给 `generateStyleCardFromExcerpts`
- 将 fingerprint 存入 `author_book_cards.fingerprint_json`

**在 `mergeAuthorStyle` 中：**
- 从各 book card 的 `fingerprint_json` 读取指纹
- 传递给新的 `mergeBookProfilesToAuthorProfile`

### 3. 在 style-snapshot.ts 中接入 PROSE 收敛

**修改文件：** `src/server/style/style-snapshot.ts`

在 `generateStyleCardFromExcerpts` 中，book 模式的最后阶段（styleProfile 已生成后）：

```typescript
// 可选：PROSE 迭代收敛
if (fingerprint && input.imports[0].excerpts.length >= 8) {
  try {
    const writerPrompt = "你是小说主笔 Writer。\n..."; // 从 prompts/writer.md 读取或硬编码精简版
    const convergenceResult = await iterativeStyleConvergence({
      initialProfile: styleProfile,
      referenceFingerprint: fingerprint,
      referenceExcerpts: input.imports[0].excerpts,
      maxIterations: 2,
      writerSystemPrompt: writerPrompt,
      llmCall: input.llmCall,
    });
    if (convergenceResult.convergenceScore > 0.5) {
      styleProfile = convergenceResult.refinedProfile;
    }
    // 可选：把 convergenceScore 存到 confidence 或 debug 信息中
  } catch {
    // 收敛失败不影响主流程
  }
}
```

**注意：** PROSE 收敛是可选层，任何异常都不应阻断主流程。用 try-catch 包裹并静默降级。

### 4. 新建测试

**新建文件：** `src/server/style/style-convergence.test.ts`

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("style-convergence", () => {
  // 注意：PROSE 收敛依赖 LLM 调用，测试需要 mock
  // 可以测试 computeDivergences 的纯逻辑部分

  it("should compute divergences between two fingerprints", () => {
    // 构造两个 StyleFingerprint
    // 验证 computeDivergences 返回正确的偏差列表
  });

  it("should return high convergence score for identical fingerprints", () => {
    // 相同 fingerprint → convergenceScore 接近 1
  });

  it("should detect large divergence in sentence length", () => {
    // 句长差异大 → deviation > 0.3
  });
});
```

如果 `computeDivergences` 没有导出，可以在测试中直接 import 并测试，或者将其改为 export。

### 5. 全链路验证

```bash
cd platform
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

### 6. 健康度检查

```bash
# 洪荒关键词已从风格模块全面清除
grep -rn "灵纹\|印记\|禁制\|阵纹\|法门\|反噬\|血气\|铜铃\|兽道" src/server/style/ --include="*.ts" | grep -v ".test.ts"
# 预期为空

# 新模块存在
test -f src/server/style/style-fingerprint.ts && echo "fingerprint OK"
test -f src/server/style/style-convergence.ts && echo "convergence OK"

# Map-Reduce 函数存在
grep -n "mapStyleFacets\|reduceStyleProfile" src/server/style/style-steering.ts | head -5
# 预期：至少 2 处 export function

# 指纹持久化字段存在
grep -n "fingerprint" src/server/db/schema.ts
# 预期：至少 1 处 fingerprintJson

# 旧采样上限已替换
grep -n "excerptCount: 12" src/server/style/style-reference-import.ts
# 预期为空

# 旧函数标记 deprecated
grep -n "@deprecated" src/server/style/style-steering.ts
# 预期：至少 2 处

# fingerprint 在 import 流程中被计算
grep -n "computeStyleFingerprint" src/server/style/style-reference-import.ts
# 预期：至少 1 处调用
```

### 7. 如果有验证失败

- 分析根因，修复问题
- 重新运行全量验证
- 在输出中说明发现了什么问题以及如何修复

## 验证标准

- [ ] `style-fingerprint.ts` 存在并有测试
- [ ] `style-convergence.ts` 存在并有测试
- [ ] 洪荒关键词在 `style/` 目录下全面清除
- [ ] 采样数量上限为 30（原 12）
- [ ] `mapStyleFacets` + `reduceStyleProfile` 替代旧的两步串行
- [ ] `mergeBookProfilesToAuthorProfile` 替代 excerpts 拼接重跑
- [ ] fingerprint 可持久化到数据库
- [ ] PROSE 收敛可选执行，异常不阻断主流程
- [ ] pnpm lint 无错误
- [ ] pnpm typecheck 无错误
- [ ] pnpm test 所有测试通过
- [ ] pnpm build 构建成功

## 约束

- PROSE 收敛层任何异常都必须 try-catch 静默降级，不阻断主流程
- 不删除 `interpretStyleReference` 和 `compileStyleProfile`（保留兼容，标 @deprecated）
- `author_text_imports` 表结构尽量不改（fingerprint 存在 book card 级别即可）
- 新增数据库字段都有 `default` 值（兼容已有数据）
- 不改 prompts/ 目录
- 不改前端组件
