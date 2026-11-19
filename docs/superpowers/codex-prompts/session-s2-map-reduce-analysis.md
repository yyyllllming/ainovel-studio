# Codex Prompt — Session S2: Map-Reduce LLM 风格分析

## 上下文

AINovel Studio（`platform/`）已完成：
- Session S1：确定性文体指纹（`style-fingerprint.ts`）+ 采样去洪荒化 + 数量提升到 20-30 条

当前 LLM 风格分析的问题：
- `style-steering.ts` 的 `interpretStyleReference`（第 664-752 行）：一次调用 12 条 excerpt → 8 维自然语言
- `style-steering.ts` 的 `compileStyleProfile`（第 759-804 行）：只拿 8 维文字（不带原文）→ 生成 StyleProfile JSON
- 两步串行，信息在中间层被大幅压缩。compile 不带原文证据，WritingCharter 数值全靠 LLM 凭印象猜
- `style-snapshot.ts` 的 `buildSnapshotDigest`（第 231-284 行）：模板拼接 + padding 循环补字
- `style-snapshot.ts` 的 author 模式（第 400-460 行）：多书 excerpts 拼一起重跑 interpret+compile，无交叉比对

本 Session 用 Map-Reduce 替代两步串行，接入 S1 的指纹校准。

## 任务

### 1. Map 阶段：分批风格切面提取

**修改文件：** `src/server/style/style-steering.ts`

**新增 `StyleFacet` 类型和 `mapStyleFacets` 函数：**

```typescript
export interface StyleFacet {
  narrativeDistance: string;    // 叙事距离观察
  dialogueStyle: string;       // 对白风格观察
  emotionMethod: string;       // 情绪外化手法
  pacing: string;              // 节奏和段落特征
  distinctivePatterns: string[]; // 独特写法模式（2-4 条）
  antiPatterns: string[];      // 典型避免的写法（1-3 条）
}

const MAP_SYSTEM_PROMPT = `你是一位资深文学编辑，正在分析小说文本的写作风格。

你会收到一组文本片段（来自同一本书的不同位置）。请分析这些片段的写作风格特征。

输出严格合法的 JSON，包含以下字段：
- narrativeDistance: 叙事距离（作者站多远？解释多不多？贴近角色还是俯瞰？）
- dialogueStyle: 对白风格（角色怎么说话？留白多不多？对白标签的使用？）
- emotionMethod: 情绪表达（直接写内心还是用动作/环境暗示？）
- pacing: 节奏特征（句长变化、段落组织、场景切换速度）
- distinctivePatterns: 2-4 条这批文本中最显著的写法特征
- antiPatterns: 1-3 条这种风格明显在避免的写法

只分析提供的文本片段，不要假设或推断未给出的内容。
不要模仿原句，只提取可泛化的技法特征。`;

export async function mapStyleFacets(input: {
  excerptBatch: StyleExcerpt[];
  batchIndex: number;
  totalBatches: number;
  genre?: string;
  llmCall: (messages: ChatMessage[]) => Promise<string>;
}): Promise<StyleFacet> {
  const excerptText = input.excerptBatch
    .map((entry, i) => `--- 片段 ${i + 1} / ${entry.label} / ${entry.tags.join("/") || "narrative"} ---\n${entry.content}`)
    .join("\n\n");

  const userPrompt = [
    input.genre ? `题材：${input.genre}` : "",
    `分析批次：${input.batchIndex + 1}/${input.totalBatches}`,
    "",
    excerptText,
  ].filter(Boolean).join("\n");

  try {
    const raw = await input.llmCall([
      { role: "system", content: MAP_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ]);
    const parsed = safeParseJson<Record<string, unknown>>(
      raw.replace(/```json?\s*/g, "").replace(/```\s*/g, "").trim(),
    );
    if (!parsed) throw new Error("map facet JSON parse failed");
    return {
      narrativeDistance: String(parsed.narrativeDistance ?? ""),
      dialogueStyle: String(parsed.dialogueStyle ?? ""),
      emotionMethod: String(parsed.emotionMethod ?? ""),
      pacing: String(parsed.pacing ?? ""),
      distinctivePatterns: Array.isArray(parsed.distinctivePatterns)
        ? parsed.distinctivePatterns.map(String).filter(Boolean)
        : [],
      antiPatterns: Array.isArray(parsed.antiPatterns)
        ? parsed.antiPatterns.map(String).filter(Boolean)
        : [],
    };
  } catch {
    return {
      narrativeDistance: "贴近 POV 即时感受",
      dialogueStyle: "对白自然留白",
      emotionMethod: "动作和感官外化",
      pacing: "长短句交替",
      distinctivePatterns: [],
      antiPatterns: [],
    };
  }
}
```

**分批策略函数：**

```typescript
export function batchExcerpts(excerpts: StyleExcerpt[], batchSize = 5): StyleExcerpt[][] {
  const batches: StyleExcerpt[][] = [];
  for (let i = 0; i < excerpts.length; i += batchSize) {
    batches.push(excerpts.slice(i, i + batchSize));
  }
  return batches;
}
```

### 2. Reduce 阶段：合并切面 + 指纹校准

**修改文件：** `src/server/style/style-steering.ts`

**新增 `reduceStyleProfile` 函数：**

```typescript
import type { StyleFingerprint } from "./style-fingerprint.ts";

const REDUCE_SYSTEM_PROMPT = `你是风格规则编译器。你会收到两类输入：

1. 多个风格切面（从不同文本段落独立提取的质性分析）
2. 文体指纹（从全文统计的确定性数据，这些是客观事实）

你的任务：将风格切面合并为统一的写作执行规则。

核心原则：
- 质性描述（叙事距离、情绪手法等）从切面中提取共性，忽略只出现一次的孤立特征
- 数值约束（章长、对白占比、句长分布等）以指纹数据为准，不要自己猜数字
- 如果切面之间有矛盾，选出现频率更高的特征
- 每条规则必须是祈使句，可直接放进 LLM 的 system prompt 执行
- 不要模仿具体原句措辞，只提取叙事技法

输出严格合法的 JSON，包含 StyleProfile 的所有字段，以及嵌套 writingCharter。

其中 writingCharter 必须包含：chapterLengthRule, openingMoveRule, infoRevealRule, mechanismRevealRule, mechanismRevealRedlines, emotionLandingRule, chapterClosureRule, transitionRule, pauseRule, endingPolicy, mechanismRevealPolicy, transitionBudget, simileBudget, subjectLeadBudget, motifReuseBudget, aiFlavorAvoidance, tabooReminders。`;

export async function reduceStyleProfile(input: {
  facets: StyleFacet[];
  fingerprint: StyleFingerprint;
  genre?: string;
  manualGuidance?: string;
  avoidances?: string;
  llmCall: (messages: ChatMessage[]) => Promise<string>;
}): Promise<StyleProfile> {
  // 1. 合并所有 facets 的文字
  const facetSummary = input.facets.map((f, i) => [
    `=== 切面 ${i + 1} ===`,
    `叙事距离：${f.narrativeDistance}`,
    `对白风格：${f.dialogueStyle}`,
    `情绪手法：${f.emotionMethod}`,
    `节奏：${f.pacing}`,
    `显著特征：${f.distinctivePatterns.join("；") || "无"}`,
    `避免写法：${f.antiPatterns.join("；") || "无"}`,
  ].join("\n")).join("\n\n");

  // 2. 格式化指纹数据
  const fp = input.fingerprint;
  const fingerprintSection = [
    "=== 文体指纹（确定性数据，以此为准）===",
    `句长：均值=${fp.sentenceLength.mean.toFixed(1)}字，中位数=${fp.sentenceLength.median}字，短句占${(fp.sentenceLength.shortRatio * 100).toFixed(0)}%，中句占${(fp.sentenceLength.mediumRatio * 100).toFixed(0)}%，长句占${(fp.sentenceLength.longRatio * 100).toFixed(0)}%`,
    `段落：均值=${fp.paragraphLength.mean.toFixed(0)}字，一句一段占比=${(fp.paragraphLength.singleSentenceRatio * 100).toFixed(0)}%`,
    `对白：占比=${(fp.dialogue.overallRatio * 100).toFixed(0)}%，平均长度=${fp.dialogue.averageLength.toFixed(0)}字`,
    `标点每千字：逗号=${fp.punctuation.comma.toFixed(1)}，句号=${fp.punctuation.period.toFixed(1)}，感叹=${fp.punctuation.exclamation.toFixed(1)}，问号=${fp.punctuation.question.toFixed(1)}，省略号=${fp.punctuation.ellipsis.toFixed(1)}，破折号=${fp.punctuation.dash.toFixed(1)}`,
    fp.chapter.count >= 2 ? `章节：${fp.chapter.count}章，均值=${fp.chapter.averageWords}字，范围${fp.chapter.minWords}-${fp.chapter.maxWords}字` : "",
  ].filter(Boolean).join("\n");

  const userPrompt = [
    input.genre ? `题材：${input.genre}` : "",
    input.manualGuidance ? `用户补充指导：${input.manualGuidance}` : "",
    input.avoidances ? `明确回避：${input.avoidances}` : "",
    "",
    facetSummary,
    "",
    fingerprintSection,
    "",
    "请综合以上信息，生成完整的 StyleProfile JSON。",
    "数值型字段（如 maxPerChapter、maxPronounLeads 等）务必参考文体指纹数据来设定，不要凭空猜测。",
    "例如：如果对白占比 40%，对白相关的规则应反映这个密度；如果一句一段占比 5%，不要鼓励碎段。",
  ].filter(Boolean).join("\n");

  try {
    const raw = await input.llmCall([
      { role: "system", content: REDUCE_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ]);
    const parsed = safeParseJson<Record<string, unknown>>(
      raw.replace(/```json?\s*/g, "").replace(/```\s*/g, "").trim(),
    );
    if (!parsed) throw new Error("reduce profile JSON parse failed");
    const profile = normalizeStyleProfile(parsed);
    return applyFingerprintToCharter(profile, input.fingerprint);
  } catch {
    const fallback = buildFallbackStyleProfile({
      references: [],
      manualGuidance: input.manualGuidance,
      avoidances: input.avoidances,
    });
    return applyFingerprintToCharter(fallback, input.fingerprint);
  }
}
```

**新增 `applyFingerprintToCharter` 函数：**

```typescript
function applyFingerprintToCharter(
  profile: StyleProfile,
  fingerprint: StyleFingerprint,
): StyleProfile {
  const charter = profile.writingCharter;
  if (!charter) return profile;

  return {
    ...profile,
    writingCharter: {
      ...charter,
      // 章长规则：用确定性数据替代 LLM 猜测
      chapterLengthRule: fingerprint.chapter.count >= 3
        ? `参考原作章均 ${fingerprint.chapter.averageWords} 字（范围 ${fingerprint.chapter.minWords}-${fingerprint.chapter.maxWords}），写满完整场景推进。`
        : charter.chapterLengthRule,
      // 主体起句预算：根据段落风格调整
      subjectLeadBudget: {
        ...charter.subjectLeadBudget,
        maxPronounLeads: fingerprint.paragraphLength.singleSentenceRatio > 0.25
          ? Math.min(8, charter.subjectLeadBudget.maxPronounLeads + 2)
          : charter.subjectLeadBudget.maxPronounLeads,
      },
    },
  };
}
```

**保留现有的 `interpretStyleReference` 和 `compileStyleProfile` 函数不删除**（兼容旧调用方），但标注 `@deprecated`。

### 3. 重构 style-snapshot.ts 的编排

**修改文件：** `src/server/style/style-snapshot.ts`

#### 3a. 重构 `buildSingleBookSnapshot`

**修改第 304-356 行的 `buildSingleBookSnapshot`：**

```typescript
import { batchExcerpts, mapStyleFacets, reduceStyleProfile, type StyleFacet } from "./style-steering.ts";
import { computeStyleFingerprint, type StyleFingerprint } from "./style-fingerprint.ts";
import { splitStyleReferenceSections } from "./style-reference-import.ts";

async function buildSingleBookSnapshot(
  input: Omit<GenerateStyleCardFromExcerptsInput, "mode" | "imports"> & {
    importEntry: StyleGenerationImport & { normalizedText?: string; fingerprint?: StyleFingerprint };
  },
) {
  const imports = [input.importEntry];
  const references = deriveReferences("book", imports, input.references);
  const genre = input.genre ?? "未指定题材";

  // 1. 获取或计算 fingerprint
  const fingerprint = input.importEntry.fingerprint
    ?? (input.importEntry.normalizedText
      ? computeStyleFingerprint(
          input.importEntry.normalizedText,
          splitStyleReferenceSections(input.importEntry.normalizedText),
        )
      : null);

  // 2. Map 阶段：分批提取风格切面（并行）
  const batches = batchExcerpts(imports[0].excerpts, 5);
  const facets = await Promise.all(
    batches.map((batch, index) =>
      mapStyleFacets({
        excerptBatch: batch,
        batchIndex: index,
        totalBatches: batches.length,
        genre,
        llmCall: input.llmCall,
      }),
    ),
  );

  // 3. Reduce 阶段：合并切面 + 指纹校准
  let styleProfile: StyleProfile;
  if (fingerprint) {
    styleProfile = await reduceStyleProfile({
      facets,
      fingerprint,
      genre,
      manualGuidance: input.manualGuidance,
      avoidances: input.avoidances,
      llmCall: input.llmCall,
    });
  } else {
    // fingerprint 不可用时 fallback 到旧路径
    const importedSourceSummary = buildImportedSourceSummary("book", imports);
    const baseProfile = buildFallbackStyleProfile({
      references,
      manualGuidance: input.manualGuidance,
      avoidances: input.avoidances,
      worldContext: input.worldContext,
      workshopContext: input.workshopContext,
      draft: input.draft,
    });
    const interpretation = await interpretStyleReference({
      references,
      samples: input.samples ?? [],
      genre,
      premise: input.premise ?? "",
      importedSourceSummary,
      sampledExcerptEvidence: imports[0].excerpts,
      mode: "book",
      llmCall: input.llmCall,
    }).catch(() => fallbackInterpretation(`${imports[0].title} 风格锚点`));
    styleProfile = await compileStyleProfile({
      interpretation,
      baseProfile,
      manualGuidance: input.manualGuidance,
      avoidances: input.avoidances,
      llmCall: input.llmCall,
    }).catch(() => baseProfile);
  }

  // 4. Exemplar 选取 + Digest 生成（不变）
  const confidence = imports[0].confidence;
  const styleExemplars = selectStyleExemplars(imports[0].excerpts, confidence);
  const importedSourceSummary = buildImportedSourceSummary("book", imports);
  const styleDigest = buildSnapshotDigest({
    mode: "book",
    imports,
    styleProfile,
    exemplars: styleExemplars,
    confidence,
    importedSourceSummary,
  });

  // 5. 提取 signature
  const signature = facets.length
    ? (facets.flatMap(f => f.distinctivePatterns).filter(Boolean)[0] ?? "场景驱动叙事")
    : "场景驱动叙事";

  return {
    interpretation: {
      narrativeDistance: facets.map(f => f.narrativeDistance).filter(Boolean).join("；"),
      infoDelivery: "",
      paragraphRhythm: facets.map(f => f.pacing).filter(Boolean).join("；"),
      dialogueBreathing: facets.map(f => f.dialogueStyle).filter(Boolean).join("；"),
      emotionRendering: facets.map(f => f.emotionMethod).filter(Boolean).join("；"),
      chapterClosure: "",
      forbiddenPatterns: facets.flatMap(f => f.antiPatterns),
      signature,
    },
    styleProfile,
    styleDigest,
    styleExemplars,
    sampledExcerpts: imports[0].excerpts,
    confidence,
    fingerprint,
  };
}
```

#### 3b. 重构 author 模式合并

**修改第 400-460 行的 author 模式逻辑：**

新增 `mergeBookProfilesToAuthorProfile`：

```typescript
async function mergeBookProfilesToAuthorProfile(input: {
  bookResults: Array<{
    title: string;
    styleProfile: StyleProfile;
    fingerprint: StyleFingerprint | null;
  }>;
  manualGuidance?: string;
  avoidances?: string;
  llmCall: (messages: ChatMessage[]) => Promise<string>;
}): Promise<StyleProfile> {
  const MERGE_SYSTEM_PROMPT = `你是风格合并专家。你会收到多本书的独立风格分析。

任务：找出跨书稳定出现的写法特征，合并为一个作者级风格档案。

规则：
- 至少 60% 书目都出现的特征 → 纳入作者风格
- 只出现在 1 本书中的特征 → 标记为该书特有，不纳入
- 数值指标取各书的中位数
- 输出完整的 StyleProfile JSON，包含嵌套 writingCharter`;

  const booksSection = input.bookResults.map((book, i) => {
    const fp = book.fingerprint;
    return [
      `=== 书目 ${i + 1}：${book.title} ===`,
      `叙事距离：${book.styleProfile.narrativeDistance.intimacyRule}`,
      `对白风格：${book.styleProfile.dialogueStyle.voiceRule}`,
      `情绪手法：${book.styleProfile.emotionRenderingRule}`,
      `开篇策略：${book.styleProfile.openingStrategy}`,
      `章末策略：${book.styleProfile.chapterClosureRule}`,
      fp ? `文体指纹：句均${fp.sentenceLength.mean.toFixed(0)}字，对白占${(fp.dialogue.overallRatio * 100).toFixed(0)}%，章均${fp.chapter.averageWords}字` : "",
    ].filter(Boolean).join("\n");
  }).join("\n\n");

  try {
    const raw = await input.llmCall([
      { role: "system", content: MERGE_SYSTEM_PROMPT },
      { role: "user", content: booksSection },
    ]);
    const parsed = safeParseJson<Record<string, unknown>>(
      raw.replace(/```json?\s*/g, "").replace(/```\s*/g, "").trim(),
    );
    if (!parsed) throw new Error("merge profile JSON parse failed");
    const merged = normalizeStyleProfile(parsed);

    // 用各书 fingerprint 的中位数校准数值
    const fingerprints = input.bookResults.map(b => b.fingerprint).filter(Boolean) as StyleFingerprint[];
    if (fingerprints.length >= 2) {
      const medianFingerprint = computeMedianFingerprint(fingerprints);
      return applyFingerprintToCharter(merged, medianFingerprint);
    }
    return merged;
  } catch {
    return buildFallbackStyleProfile({
      references: [],
      manualGuidance: input.manualGuidance,
      avoidances: input.avoidances,
    });
  }
}

function computeMedianFingerprint(fingerprints: StyleFingerprint[]): StyleFingerprint {
  // 对每个数值字段取中位数
  // 这是一个辅助函数，取所有 fingerprint 的中位数构造一个"合成指纹"
  const med = (fn: (fp: StyleFingerprint) => number) => {
    const values = fingerprints.map(fn).sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    return values.length % 2 === 0 ? (values[mid - 1]! + values[mid]!) / 2 : values[mid]!;
  };
  // 实现：对 sentenceLength.mean, paragraphLength.mean, dialogue.overallRatio 等全部取中位数
  // 注意 topBigrams 和 openingPattern 等非数值字段需要特殊处理（取第一本的或合并）
  // 具体实现由 Codex 自行决定
}
```

然后在 `generateStyleCardFromExcerpts` 的 author 模式分支中：

```typescript
// 替代当前的"excerpts 拼在一起重跑"逻辑
const bookSnapshots = await Promise.all(
  input.imports.map((entry) => buildSingleBookSnapshot({ ...input, importEntry: entry })),
);

const authorProfile = await mergeBookProfilesToAuthorProfile({
  bookResults: bookSnapshots.map((snap, i) => ({
    title: input.imports[i]!.title,
    styleProfile: snap.styleProfile,
    fingerprint: snap.fingerprint ?? null,
  })),
  manualGuidance: input.manualGuidance,
  avoidances: input.avoidances,
  llmCall: input.llmCall,
});
```

### 4. 更新 StyleGenerationImport 类型

**修改文件：** `src/server/style/style-snapshot.ts`

```typescript
export interface StyleGenerationImport {
  id: string;
  title: string;
  author?: string;
  wordCount: number;
  confidence: StyleConfidence;
  excerpts: StyleExcerpt[];
  encoding?: string | null;
  // 新增（optional，兼容旧数据）
  normalizedText?: string;
  fingerprint?: StyleFingerprint;
}
```

## 验证命令

```bash
cd platform
pnpm typecheck
pnpm test
pnpm build

# 确认 Map-Reduce 函数存在
grep -n "mapStyleFacets\|reduceStyleProfile\|mergeBookProfilesToAuthorProfile" src/server/style/style-steering.ts
# 预期：至少 3 处定义

# 确认旧函数标记 deprecated
grep -n "@deprecated" src/server/style/style-steering.ts
# 预期：interpretStyleReference 和 compileStyleProfile 前各有 @deprecated

# 确认 buildSingleBookSnapshot 使用新流程
grep -n "mapStyleFacets\|reduceStyleProfile" src/server/style/style-snapshot.ts
# 预期：至少 2 处调用
```

## 约束

- 保留 `interpretStyleReference` 和 `compileStyleProfile` 函数（标 @deprecated，不删除）
- 新流程在 fingerprint 不可用时自动 fallback 到旧流程
- 不改 `style-reference-import.ts`（S1 已完成）
- 不改 `style-fingerprint.ts`（S1 已完成）
- 不改数据库 schema（S3 负责）
- 不改 `author-card.service.ts`（S3 负责集成通路）
- 新增的类型字段全部 optional（兼容）
