# 风格卡提取管线升级计划 — 从 2% 采样到分层精准提取

> 2026-04-03 · 3 Session · 预计 10 Task
> 前置依赖：作者卡架构重组已完成

## 背景

当前风格卡生成管线的核心问题：

1. **采样覆盖率极低**：12 万字书只抽 10-12 条 × ~260 字 = 2,600 字（2.2% 覆盖），统计显著性极弱
2. **标签分类洪荒硬编码**：MECHANISM_KEYWORDS（灵纹/印记/禁制/反噬/血气）、HOOK_MARKERS（铜铃/兽道）等完全绑死玄幻题材
3. **LLM 分析两步串行压缩严重**：interpret（8 维自然语言）→ compile（无原文），中间层信息大量丢失
4. **无确定性基线**：WritingCharter 的数值参数（句长/段长/对白比/比喻预算等）全靠 LLM 猜，没有从原文统计
5. **digest 机械拼接**：模板字符串 + padding 循环补字，可读性低
6. **作者合并粗暴**：多书 excerpts 拼在一起重跑，无交叉比对

## 解决方案：4 层递进提取

```
Layer 0：确定性文体指纹（全文扫描，零 API 成本）
    ↓ 输出 StyleFingerprint JSON
Layer 1：去洪荒化采样 + 数量提升（10→30 条代表性样本）
    ↓ 输出 30 条 StyleExcerpt
Layer 2：Map-Reduce LLM 分析（替代两步串行）
    ↓ 输出 StyleProfile + WritingCharter（数值由 Layer 0 校准）
Layer 3：PROSE 迭代收敛（可选，高级验证）
    ↓ 输出精炼后的 StyleProfile
```

---

## Session S1 — 确定性文体指纹 + 采样去洪荒化

### Task S1.1 — 新建 style-fingerprint.ts

**新建文件：** `src/server/style/style-fingerprint.ts`

从完整清洗文本中提取确定性量化特征，零 LLM 成本：

```typescript
export interface StyleFingerprint {
  // 句长分布
  sentenceLength: {
    mean: number;
    median: number;
    stddev: number;
    shortRatio: number;    // < 15 字
    mediumRatio: number;   // 15-40 字
    longRatio: number;     // > 40 字
  };
  // 段落分布
  paragraphLength: {
    mean: number;
    median: number;
    singleSentenceRatio: number;  // 一句一段的比例
  };
  // 对白特征
  dialogue: {
    overallRatio: number;          // 对白字数/总字数
    averageLength: number;         // 平均单条对白长度
    averageSurroundingAction: number; // 对白间穿插动作描写的平均长度
  };
  // 标点使用频率（每千字）
  punctuation: {
    comma: number;        // 逗号
    period: number;       // 句号
    exclamation: number;  // 感叹号
    question: number;     // 问号
    ellipsis: number;     // 省略号
    dash: number;         // 破折号
    semicolon: number;    // 分号
  };
  // 章节特征
  chapter: {
    count: number;
    averageWords: number;
    minWords: number;
    maxWords: number;
  };
  // 开头模式
  openingPattern: {
    sceneRatio: number;      // 场景/环境切入
    dialogueRatio: number;   // 对话切入
    actionRatio: number;     // 动作切入
    introspectionRatio: number; // 心理/回忆切入
  };
  // 词汇特征
  vocabulary: {
    uniqueRatio: number;     // 类型/令牌比（TTR）
    topBigrams: string[];    // 高频二字词 top 20
  };
}

export function computeStyleFingerprint(
  normalizedText: string,
  sections: ReferenceSection[],
): StyleFingerprint;
```

**测试文件：** `src/server/style/style-fingerprint.test.ts`

### Task S1.2 — 将指纹注入 WritingCharter 参数

**修改文件：** `src/server/style/style-steering.ts`

在 `compileStyleProfile` 的 Reduce 阶段（或现有 compile 中），用 StyleFingerprint 的确定性数据覆盖 LLM 猜测的数值：

```typescript
function applyFingerprintToCharter(
  charter: WritingCharter,
  fingerprint: StyleFingerprint,
): WritingCharter {
  return {
    ...charter,
    // 比喻预算：从指纹的 ellipsis+dash 频率推断修辞密度
    simileBudget: {
      ...charter.simileBudget,
      maxPerChapter: fingerprint.punctuation.ellipsis > 3
        ? Math.min(6, Math.round(fingerprint.punctuation.ellipsis))
        : charter.simileBudget.maxPerChapter,
    },
    // 主体起句预算：从段落分布推断
    subjectLeadBudget: {
      ...charter.subjectLeadBudget,
      maxPronounLeads: fingerprint.paragraphLength.singleSentenceRatio > 0.3
        ? 6 : charter.subjectLeadBudget.maxPronounLeads,
    },
    // 章长规则：从章节统计推断
    chapterLengthRule: fingerprint.chapter.count >= 3
      ? `参考原作章均 ${fingerprint.chapter.averageWords} 字（范围 ${fingerprint.chapter.minWords}-${fingerprint.chapter.maxWords}），写满完整场景。`
      : charter.chapterLengthRule,
  };
}
```

### Task S1.3 — 采样标签分类：从关键词检测改为纯结构检测

**修改文件：** `src/server/style/style-reference-import.ts`

**删除所有关键词常量（第 35-42 行）——一个不留：**
- `CONFLICT_KEYWORDS`、`EMOTION_KEYWORDS`、`MECHANISM_KEYWORDS`
- `MECHANISM_REVEAL_MARKERS`、`MECHANISM_EXPLANATION_MARKERS`
- `HOOK_MARKERS`、`SILENCE_MARKERS`、`PRESSURE_MARKERS`

**重写 `classifyExcerptTags` 为纯结构/统计检测：**

每个标签只依赖句长分布、标点密度、对白比例、句长趋势等统计特征：

| 标签 | 检测依据 | 为什么平台级 |
|------|---------|------------|
| dialogue | 引号包围文本占比 | 任何语言的对白都用引号 |
| conflict | 句长变异系数高 + 感叹密度高 | 冲突节奏是急促跳跃的，不论写打架还是吵架 |
| emotion | 省略号/破折号密度高 or 句长突变 | 情绪停顿体现在标点气口上，不论什么情绪 |
| mechanism | 长句 + 高逗号 + 低对白 + 低变异 | 解说段不论解说什么，句法都偏复杂平稳 |
| silence | 短句 + 低对白 + 少修饰标点 | 沉默段落在任何题材都是简洁平直 |
| pressure | 句长呈递减趋势 | 紧迫感 ="越来越快"，这是结构规律 |
| hook | 段尾无闭合（省略/破折/问句结尾） | 悬念的标志是"没说完"，这是标点特征 |

**同时重写 `scoreCandidate`：** 删除所有关键词相关的加分/惩罚逻辑。

### Task S1.4 — 采样数量从 10-12 提升到 20-30

**修改文件：** `src/server/style/style-reference-import.ts`

**修改 `resolveStyleImportConfidence`（第 383-397 行）：**

```typescript
export function resolveStyleImportConfidence(totalWords: number) {
  if (totalWords < 8_000) return { excerptCount: 8, confidence: "low" as const };
  if (totalWords < 20_000) return { excerptCount: 12, confidence: "low" as const };
  if (totalWords < 50_000) return { excerptCount: 18, confidence: "medium" as const };
  if (totalWords < 120_000) return { excerptCount: 24, confidence: "high" as const };
  return { excerptCount: 30, confidence: "high" as const };
}
```

**修改 `sampleStyleExcerpts`（第 448-608 行）中的位置配额：**

```typescript
const quotas = {
  opening: Math.max(2, Math.round(excerptCount * 0.15)),
  middle: Math.max(4, Math.round(excerptCount * 0.55)),
  ending: Math.max(2, Math.round(excerptCount * 0.15)),
  // 新增：跨章过渡段（章末+下章开头）
  transition: Math.max(2, Math.round(excerptCount * 0.15)),
};
```

**放宽对白重片段限制（第 470-474 行）：**
- 从 `dialogueHeavyCount >= 1` 改为 `dialogueHeavyCount >= Math.max(2, Math.round(excerptCount * 0.15))`

### 完成标准

- [ ] `computeStyleFingerprint()` 能从任意中文文本提取 20+ 量化特征
- [ ] **所有**关键词常量已删除（CONFLICT/EMOTION/MECHANISM/...全部，零残留）
- [ ] `classifyExcerptTags` 纯结构检测，函数体内无中文词汇字面量
- [ ] 采样数量按新规则（8/12/18/24/30）
- [ ] fingerprint 测试覆盖（句长/段落/对白/标点维度各至少 1 个用例）
- [ ] pnpm typecheck 通过
- [ ] pnpm test 通过

---

## Session S2 — Map-Reduce LLM 风格分析

### Task S2.1 — Map 阶段：分批抽取风格切面

**修改文件：** `src/server/style/style-steering.ts`

新增 `mapStyleFacets` 函数，替代当前的单次 `interpretStyleReference`：

```typescript
export interface StyleFacet {
  narrativeDistance: string;
  dialogueStyle: string;
  emotionMethod: string;
  pacing: string;
  distinctivePatterns: string[];
  antiPatterns: string[];
}

export async function mapStyleFacets(input: {
  excerptBatch: StyleExcerpt[];
  batchIndex: number;
  totalBatches: number;
  genre?: string;
  llmCall: (messages: ChatMessage[]) => Promise<string>;
}): Promise<StyleFacet> {
  // 每 5 条 excerpt 一次 LLM 调用
  // system prompt 要求输出 StyleFacet JSON
  // 用 safeParseJsonSchema 强制 schema 验证
}
```

**Map 的分批策略：**
- 每批 5 条 excerpt（30 条 → 6 批）
- 各批可并行（Promise.all）
- 每批的 system prompt 相同，user prompt 只包含该批的原文

### Task S2.2 — Reduce 阶段：合并切面 + 指纹校准

**修改文件：** `src/server/style/style-steering.ts`

新增 `reduceStyleProfile` 函数，替代当前的 `compileStyleProfile`：

```typescript
export async function reduceStyleProfile(input: {
  facets: StyleFacet[];
  fingerprint: StyleFingerprint;
  genre?: string;
  manualGuidance?: string;
  avoidances?: string;
  llmCall: (messages: ChatMessage[]) => Promise<string>;
}): Promise<StyleProfile> {
  // 1. 将所有 facets 的文字合并为 LLM 输入
  // 2. 同时将 fingerprint 的数值指标作为硬约束传入
  // 3. 要求 LLM 输出完整 StyleProfile JSON
  // 4. 输出后用 applyFingerprintToCharter 覆盖数值字段
}
```

**Reduce 的 system prompt 关键改进：**
```
你是风格规则编译器。

你会收到两类输入：
1. 多个风格切面（从不同文本段落独立提取）——代表质性分析
2. 文体指纹（从全文统计的确定性数据）——代表量化事实

规则：
- 质性描述（叙事距离、情绪手法等）从切面中提取共性，忽略孤立特征
- 数值约束（章长、对白占比、句长分布等）以指纹为准，不要自己猜数字
- 如果切面之间有矛盾，说明来源文本风格不统一，选出现频率最高的特征
```

### Task S2.3 — 重构 style-snapshot.ts 的编排

**修改文件：** `src/server/style/style-snapshot.ts`

将 `buildSingleBookSnapshot`（第 304-356 行）重构为新流程：

```typescript
async function buildSingleBookSnapshot(input) {
  // 新流程：
  // 1. 计算 fingerprint（来自 import 阶段已存储，或此处实时计算）
  // 2. Map：excerpts 分批 → mapStyleFacets（并行）
  // 3. Reduce：facets + fingerprint → reduceStyleProfile
  // 4. exemplar 选取不变
  // 5. digest 生成改为 LLM 生成（不再模板拼接）
}
```

**修改 `buildSnapshotDigest`（第 231-284 行）：**
- 删除 padding 循环补字逻辑
- 将 digest 改为 LLM 生成（1 次调用，输入 StyleProfile + exemplars，输出 1200-1800 字自然语言摘要）
- fallback 保留当前模板拼接逻辑

### Task S2.4 — 作者合并升级

**修改文件：** `src/server/style/style-snapshot.ts`

当前 author 模式（第 400-460 行）只是把所有书的 excerpts 拼在一起重跑。

改为：
1. 每本书已有独立的 `StyleProfile`（book 级）
2. 作者合并 = 对比多个 book profiles，提取**跨书稳定特征**
3. 新增 `mergeBookProfilesToAuthorProfile` 函数：

```typescript
export async function mergeBookProfilesToAuthorProfile(input: {
  bookProfiles: Array<{ title: string; profile: StyleProfile; fingerprint: StyleFingerprint }>;
  llmCall: (messages: ChatMessage[]) => Promise<string>;
}): Promise<StyleProfile> {
  // System prompt：
  // 你会收到 N 本书的独立风格分析。
  // 任务：找出至少 60% 书目都稳定出现的写法特征。
  // 只出现在 1 本书中的特征标记为该书特有，不纳入作者风格。
  // 数值指标取各书 fingerprint 的中位数。
}
```

### 完成标准

- [ ] Map-Reduce 替代两步串行（mapStyleFacets + reduceStyleProfile）
- [ ] Map 阶段可并行（Promise.all）
- [ ] Reduce 阶段使用指纹校准数值
- [ ] digest 改为 LLM 生成（fallback 保留模板）
- [ ] author 合并使用跨书对比而非 excerpts 拼接
- [ ] pnpm typecheck 通过
- [ ] pnpm test 通过

---

## Session S3 — PROSE 迭代收敛 + 数据通路 + 全链路验证

### Task S3.1 — PROSE 迭代收敛（可选层）

**新建文件：** `src/server/style/style-convergence.ts`

```typescript
export interface ConvergenceResult {
  refinedProfile: StyleProfile;
  iterations: number;
  convergenceScore: number;  // 0-1，越高越收敛
}

export async function iterativeStyleConvergence(input: {
  initialProfile: StyleProfile;
  referenceFingerprint: StyleFingerprint;
  referenceExcerpts: StyleExcerpt[];
  maxIterations?: number;  // 默认 2
  writerPrompt: string;    // writer.md 内容
  llmCall: (messages: ChatMessage[]) => Promise<string>;
}): Promise<ConvergenceResult> {
  // 1. 用 initialProfile 让 Writer LLM 生成 500 字测试文本
  // 2. 对生成文本计算 fingerprint
  // 3. 比较 referenceFingerprint vs 生成文本 fingerprint
  // 4. 差异大的维度 → 要求 LLM 精炼对应 profile 字段
  // 5. 循环 2-3 轮
  // 6. 返回精炼后的 profile + 收敛分数
}

function computeDivergence(
  reference: StyleFingerprint,
  generated: StyleFingerprint,
): Record<string, number> {
  // 各维度的归一化偏差
  // 句长偏差 = |ref.mean - gen.mean| / ref.mean
  // 对白占比偏差 = |ref.dialogueRatio - gen.dialogueRatio|
  // 等等
}
```

### Task S3.2 — 数据通路：fingerprint 持久化

**修改文件：** `src/server/db/schema.ts`

在 `author_book_cards` 表新增字段：
```sql
fingerprint_json TEXT NOT NULL DEFAULT '{}'
```

**修改文件：** `src/server/services/author-card.service.ts`

在 `generateBookCardForAuthor` 中：
1. 导入阶段计算 fingerprint 并存储
2. 生成 book card 时传入 fingerprint
3. 合并 author style 时传入各书 fingerprint

**修改文件：** `src/server/repositories/author-book-card.repository.ts`

`createBookCard` 和 `getBookCard` 增加 `fingerprintJson` 字段读写。

### Task S3.3 — 全链路验证

```bash
cd platform
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

### Task S3.4 — 健康度检查

```bash
# 洪荒关键词已从采样模块清除
grep -rn "灵纹\|印记\|禁制\|阵纹\|法门\|反噬\|血气\|铜铃\|兽道" src/server/style/ --include="*.ts" | grep -v ".test.ts"
# 预期为空

# 旧的采样上限已替换
grep -rn "excerptCount: 12" src/server/style/style-reference-import.ts
# 预期为空

# 旧的两步串行入口仍可调用但内部已重构
grep -rn "interpretStyleReference\|compileStyleProfile" src/server/style/style-snapshot.ts
# 预期：仍然存在（兼容入口），但内部调用 map+reduce

# fingerprint 计算函数存在
grep -rn "computeStyleFingerprint" src/server/style/ --include="*.ts"
# 预期：至少 2 个文件引用（style-fingerprint.ts + style-snapshot.ts 或 author-card.service.ts）
```

---

## 执行顺序与依赖

```
Session S1（指纹 + 采样）→ Session S2（Map-Reduce 分析）→ Session S3（收敛 + 集成 + 验证）
```

Session S1 是基础，必须先完成（其他两层都依赖指纹和新采样）。
Session S2 依赖 S1 的指纹输出。
Session S3 依赖 S2 的 Map-Reduce 输出。

## 与现有计划的关系

- **注入引擎计划**（Session 1-3）解决"怎么注入"
- **本计划**（Session S1-S3）解决"注入什么质量的数据"
- 两者可并行推进（无文件冲突）

## 预期效果对比

| 维度 | 改前 | 改后 |
|------|------|------|
| 采样覆盖率 | 2.2%（10 条×260 字） | 7%+（30 条×300 字） |
| 标签分类 | 洪荒硬编码关键词 | 纯结构/统计特征检测（零词汇依赖） |
| LLM 调用 | 2 次串行（2 步压缩） | 6 次并行 Map + 1 次 Reduce |
| WritingCharter 数值 | LLM 猜 | 确定性指纹填充 |
| 风格摘要 | 模板拼接 + padding | LLM 生成自然语言 |
| 作者合并 | excerpts 全堆重跑 | 跨书 profile 对比 |
| 迭代验证 | 无 | PROSE 生成→比对→精炼 |
