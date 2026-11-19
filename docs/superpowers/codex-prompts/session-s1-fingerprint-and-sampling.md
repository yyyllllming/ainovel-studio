# Codex Prompt — Session S1: 确定性文体指纹 + 采样去洪荒化

## 上下文

AINovel Studio（`platform/`）的风格卡提取管线有严重缺陷：
- 采样只取 10-12 条 × ~260 字 = 2,600 字（覆盖率 2.2%）
- 标签分类用洪荒题材硬编码关键词（灵纹/血气/铜铃等），换题材失效
- WritingCharter 的数值参数（句长/对白比/比喻预算等）全靠 LLM 猜，没有从原文统计
- 采样数量固定上限 12，20 万字和 5 万字的书差异不大

本 Session 做两件事：新建确定性文体指纹模块 + 采样模块去洪荒化并提升数量。

## 任务

### 1. 新建 `src/server/style/style-fingerprint.ts`

从完整清洗文本中提取确定性量化特征。这是纯计算模块，不需要 LLM。

**先读以下文件了解现有类型和工具：**
- `src/server/style/style-reference-import.ts` — 了解 `ReferenceSection`、`splitStyleReferenceSections`、`cleanImportedReferenceText` 的输入输出
- `src/server/utils.ts` — 了解 `wordCount`、`clamp` 等已有工具

**定义 StyleFingerprint 接口：**

```typescript
export interface StyleFingerprint {
  sentenceLength: {
    mean: number;
    median: number;
    stddev: number;
    shortRatio: number;     // 句长 < 15 字
    mediumRatio: number;    // 15-40 字
    longRatio: number;      // > 40 字
  };
  paragraphLength: {
    mean: number;
    median: number;
    singleSentenceRatio: number;
  };
  dialogue: {
    overallRatio: number;
    averageLength: number;
    averageSurroundingAction: number;
  };
  punctuation: {
    comma: number;
    period: number;
    exclamation: number;
    question: number;
    ellipsis: number;
    dash: number;
    semicolon: number;
  };
  chapter: {
    count: number;
    averageWords: number;
    minWords: number;
    maxWords: number;
  };
  openingPattern: {
    sceneRatio: number;
    dialogueRatio: number;
    actionRatio: number;
    introspectionRatio: number;
  };
  vocabulary: {
    uniqueRatio: number;
    topBigrams: string[];
  };
}
```

**实现 `computeStyleFingerprint` 函数：**

```typescript
import type { ReferenceSection } from "./style-reference-import.ts";

export function computeStyleFingerprint(
  normalizedText: string,
  sections: ReferenceSection[],
): StyleFingerprint {
  // --- 句长分布 ---
  // 按中文句号、感叹号、问号分句
  // 统计每句字数（去除标点和空白后的纯字符数）
  // 计算 mean, median, stddev
  // 三档比例：短 <15 / 中 15-40 / 长 >40

  // --- 段落分布 ---
  // 按连续空行分段
  // 统计段落字数、单句段比例（段内只有 1 个句号/感叹/问号）

  // --- 对白特征 ---
  // 用 /"[^"]*"|「[^」]*」|『[^』]*』|"[^"]*"/gu 提取所有对白
  // overallRatio = 对白总字数 / 全文字数
  // averageLength = 对白总字数 / 对白条数
  // averageSurroundingAction = 对白之间非对白文本的平均长度

  // --- 标点频率 ---
  // 逐字符统计，归一化为每千字频率
  // 逗号：，,  句号：。.  感叹：！!  问号：？?
  // 省略号：……/...  破折号：——/--  分号：；;

  // --- 章节特征 ---
  // 从 sections 参数获取章节数
  // 统计各章 wordCount，求均值/最小/最大

  // --- 开头模式 ---
  // 取每章前 100 字符
  // 判断是否以对白引号开头 → dialogueRatio
  // 判断是否以动词开头（跑/走/拿/推/...）→ actionRatio
  // 判断是否以环境描写开头（天/风/月/阳光/街/...）→ sceneRatio
  // 其余 → introspectionRatio

  // --- 词汇特征 ---
  // 分词（简单方案：按 2 字符滑动窗口取 bigram）
  // uniqueRatio = 不同 bigram 数 / 总 bigram 数
  // topBigrams = 按频率取 top 20（排除标点和停用词 bigram）
}
```

**辅助函数建议：**
```typescript
function splitSentences(text: string): string[];       // 按句号/感叹/问号分句
function splitParagraphs(text: string): string[];      // 按空行分段
function extractDialogueSpans(text: string): string[]; // 提取所有对白
function countChar(text: string, pattern: RegExp): number; // 统计字符出现次数
function median(numbers: number[]): number;
function stddev(numbers: number[]): number;
```

**注意：** 这些辅助函数只在本文件内使用，不需要 export。

**导出类型和函数：**
- `export interface StyleFingerprint`
- `export function computeStyleFingerprint`

### 2. 新建测试 `src/server/style/style-fingerprint.test.ts`

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeStyleFingerprint } from "./style-fingerprint.ts";

describe("computeStyleFingerprint", () => {
  const sampleText = `第一章 黎明

天还没亮，他已经在路上了。背包压着肩膀，脚步不算快，但一直没停。

"你不该来的。"她站在门口，声音很轻。

他没回头。风把衣角吹开，露出里面绑着的绷带。她看见了，什么也没说。

巷子很窄。两边的墙长满了青苔，头顶搭着晾衣绳。他侧身挤过去，肩上的伤口又裂开了。

第二章 集市

集市上人很多。叫卖声、讨价还价的嗓门、孩子的哭闹混在一起。他低着头走，尽量不引人注意。

"三块一斤，不还价。"摊主是个胖女人，嗓门比谁都大。

他从口袋里摸出几枚硬币，数了数，不够。`;

  it("should compute sentence length statistics", () => {
    const sections = [{ title: "第一章", content: sampleText.slice(0, sampleText.indexOf("第二章")), startOffset: 0, endOffset: sampleText.indexOf("第二章") }];
    const fp = computeStyleFingerprint(sampleText, sections);
    assert.ok(fp.sentenceLength.mean > 0);
    assert.ok(fp.sentenceLength.shortRatio >= 0 && fp.sentenceLength.shortRatio <= 1);
  });

  it("should detect dialogue ratio", () => {
    const fp = computeStyleFingerprint(sampleText, []);
    assert.ok(fp.dialogue.overallRatio > 0.05, "should detect dialogue");
    assert.ok(fp.dialogue.overallRatio < 0.5, "dialogue should not be majority");
  });

  it("should compute punctuation frequencies", () => {
    const fp = computeStyleFingerprint(sampleText, []);
    assert.ok(fp.punctuation.comma > 0);
    assert.ok(fp.punctuation.period > 0);
  });

  it("should handle text with no chapters gracefully", () => {
    const fp = computeStyleFingerprint("这是一段简短的测试文本。没有章节。", []);
    assert.equal(fp.chapter.count, 0);
    assert.ok(fp.sentenceLength.mean > 0);
  });

  it("should compute vocabulary uniqueRatio", () => {
    const fp = computeStyleFingerprint(sampleText, []);
    assert.ok(fp.vocabulary.uniqueRatio > 0 && fp.vocabulary.uniqueRatio <= 1);
    assert.ok(fp.vocabulary.topBigrams.length > 0);
  });
});
```

### 3. 采样模块去洪荒化

**修改文件：** `src/server/style/style-reference-import.ts`

#### 3a. 删除所有关键词常量

**删除第 35-42 行的全部关键词常量——一个不留：**
```typescript
// 全部删除，不保留任何一个
const CONFLICT_KEYWORDS = [...];
const EMOTION_KEYWORDS = [...];
const MECHANISM_KEYWORDS = [...];
const MECHANISM_REVEAL_MARKERS = [...];
const MECHANISM_EXPLANATION_MARKERS = [...];
const HOOK_MARKERS = [...];
const SILENCE_MARKERS = [...];
const PRESSURE_MARKERS = [...];
```

**不替换为新的关键词表。** 标签分类完全改为结构/统计特征检测，零词汇依赖。

#### 3b. 新增结构特征提取辅助函数

在 `classifyExcerptTags` 之前新增以下纯结构分析函数（全部 file-private，不 export）：

```typescript
/** 按中文句末标点分句，返回各句纯文本长度（不含标点和空白） */
function splitSentenceLengths(text: string): number[] {
  return text
    .split(/[。！？!?\n]+/u)
    .map(s => s.replace(/[\s，,；;：:""''「」『』【】（）()\-—…·、]/gu, "").length)
    .filter(len => len > 0);
}

/** 计算标点密度（每百字出现次数）*/
function punctuationDensity(text: string, pattern: RegExp): number {
  const hits = (text.match(pattern) ?? []).length;
  const charCount = text.replace(/\s/gu, "").length;
  return charCount > 0 ? (hits / charCount) * 100 : 0;
}

/** 检测句长是否呈递减趋势（压力/紧迫感的结构信号） */
function hasShorteningTrend(sentenceLengths: number[]): boolean {
  if (sentenceLengths.length < 4) return false;
  const mid = Math.floor(sentenceLengths.length / 2);
  const firstHalf = sentenceLengths.slice(0, mid);
  const secondHalf = sentenceLengths.slice(mid);
  const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
  return avgSecond < avgFirst * 0.7; // 后半段均句长 < 前半段的 70%
}

/** 检测句长方差是否偏高（节奏跳跃/冲突的结构信号） */
function sentenceLengthVariance(sentenceLengths: number[]): number {
  if (sentenceLengths.length < 2) return 0;
  const mean = sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length;
  const variance = sentenceLengths.reduce((sum, len) => sum + (len - mean) ** 2, 0) / sentenceLengths.length;
  return Math.sqrt(variance) / Math.max(1, mean); // 变异系数 CV
}

/** 检测段落末尾是否无闭合感（钩子/悬念的结构信号） */
function hasUnresolvedEnding(text: string): boolean {
  const trimmed = text.trimEnd();
  // 以省略号、破折号、逗号、或非句末标点结尾 → 无闭合
  if (/[…—，,；;：:\-]$/u.test(trimmed)) return true;
  // 最后一句是问句
  const lastSentenceEnd = Math.max(trimmed.lastIndexOf("。"), trimmed.lastIndexOf("！"), trimmed.lastIndexOf("？"));
  if (lastSentenceEnd >= 0 && trimmed[lastSentenceEnd] === "？") return true;
  return false;
}
```

#### 3c. 重写 `classifyExcerptTags`（第 275-315 行）——纯结构检测，零关键词

**设计原则：** 每个标签的判定只依赖句长分布、标点密度、对白比例、句长趋势等统计特征，不依赖任何词汇。这使得分类对玄幻/言情/悬疑/科幻/纯文学/外语翻译体都同样有效。

```typescript
function classifyExcerptTags(text: string, dialogueRatio: number): StyleExcerptTag[] {
  const tags: StyleExcerptTag[] = [];
  const sentLens = splitSentenceLengths(text);
  const avgSentLen = sentLens.length > 0
    ? sentLens.reduce((a, b) => a + b, 0) / sentLens.length
    : 0;
  const cv = sentenceLengthVariance(sentLens); // 句长变异系数

  // 感叹+问号密度（每百字）
  const exclamDensity = punctuationDensity(text, /[！!]/gu);
  const questionDensity = punctuationDensity(text, /[？?]/gu);
  // 省略号+破折号密度
  const ellipsisDensity = punctuationDensity(text, /[…]+|\.{3,}/gu);
  const dashDensity = punctuationDensity(text, /[—\-]{2,}|——/gu);
  // 逗号密度（高逗号=复杂长句=解说性段落）
  const commaDensity = punctuationDensity(text, /[，,]/gu);
  // 短句占比（<10 字的句子比例）
  const shortSentRatio = sentLens.length > 0
    ? sentLens.filter(len => len < 10).length / sentLens.length
    : 0;

  // ── dialogue ──
  // 纯结构：引号包围的文本占比
  if (dialogueRatio >= 0.18 || /["「『"][^"」』"]+["」』"]/u.test(text)) {
    tags.push("dialogue");
  }

  // ── conflict ──
  // 结构信号：句长变异系数高（长短交替剧烈）+ 感叹/问号密度高
  // 冲突场景的文本节奏通常急促跳跃，不论题材
  if (cv > 0.6 && (exclamDensity + questionDensity) > 0.5) {
    tags.push("conflict");
  } else if (shortSentRatio > 0.4 && exclamDensity > 0.3) {
    // 备选：大量短句 + 感叹号 → 也是冲突信号
    tags.push("conflict");
  }

  // ── emotion ──
  // 结构信号：省略号/破折号密度高（情绪停顿）或 句长突变（情绪起伏）
  // 情感段落通常有更多气口标点，不论什么题材的什么情绪
  if ((ellipsisDensity + dashDensity) > 0.3) {
    tags.push("emotion");
  } else if (cv > 0.5 && avgSentLen < 25 && dialogueRatio < 0.5) {
    // 非对白段、句短且节奏跳跃 → 内心波动
    tags.push("emotion");
  }

  // ── mechanism（解说/知识段）──
  // 结构信号：平均句长长 + 逗号密度高（复杂从句）+ 对白少
  // 解说性文本不论解说什么内容，句法结构都偏复杂平稳
  if (avgSentLen > 25 && commaDensity > 3.0 && dialogueRatio < 0.15 && cv < 0.5) {
    tags.push("mechanism");
  }

  // ── silence（静默/留白）──
  // 结构信号：短句为主 + 对白少 + 标点稀疏（少逗号，多句号）
  // 沉默段落的句法特征是简洁、平直、少修饰
  const periodDensity = punctuationDensity(text, /[。.]/gu);
  if (avgSentLen < 18 && dialogueRatio < 0.2
    && periodDensity > commaDensity * 0.8
    && (exclamDensity + questionDensity) < 0.3) {
    tags.push("silence");
  }

  // ── pressure（压力递进）──
  // 结构信号：句长呈递减趋势（越写越急促）
  if (hasShorteningTrend(sentLens)) {
    tags.push("pressure");
  } else if (sentLens.length >= 3 && shortSentRatio > 0.3 && cv > 0.5) {
    // 备选：混合短句+高变异 → 压迫感
    tags.push("pressure");
  }

  // ── hook（悬念/钩子）──
  // 结构信号：段落尾部无闭合感（省略号/破折号/问句结尾）
  if (hasUnresolvedEnding(text)) {
    tags.push("hook");
  }

  // ── narrative（叙述基底）──
  if (!tags.includes("dialogue") || dialogueRatio < 0.7) {
    tags.push("narrative");
  }

  return tags;
}
```

**为什么这样分类是平台级的：**

| 标签 | 检测依据 | 为什么不依赖题材 |
|------|---------|----------------|
| dialogue | 引号包围文本占比 | 任何语言的对白都用引号 |
| conflict | 句长变异系数 + 感叹密度 | 冲突的节奏不论写打架还是写吵架都是急促跳跃 |
| emotion | 省略号/破折号密度 + 句长突变 | 情绪停顿不论是愤怒还是心碎都体现在标点气口上 |
| mechanism | 长句 + 高逗号 + 低对白 + 低变异 | 解说段不论解说魔法体系还是金融规则，句法都偏复杂平稳 |
| silence | 短句 + 低对白 + 少修饰标点 | 沉默段落的句法在任何题材都是简洁平直 |
| pressure | 句长递减趋势 | 紧迫感的文学表达是"越来越快"，这是结构规律 |
| hook | 段尾无闭合（省略/破折/问句） | 悬念的标志是"没说完"，这是标点特征 |
| narrative | 非高对白段 | 排除法 |

#### 3d. 重写 `scoreCandidate`（第 417-446 行）——删除所有关键词引用

**当前代码引用了 `MECHANISM_EXPLANATION_MARKERS` 和 `MECHANISM_REVEAL_MARKERS`，全部删除。**

替换为纯结构评分：
```typescript
function scoreCandidate(candidate: PassageCandidate, tag?: StyleExcerptTag) {
  const targetWeight = 280; // 从 260 提到 280，略增样本长度
  const tagBonus = tag && candidate.tags.includes(tag) ? 26 : 0;
  const dialoguePenalty = candidate.dialogueRatio > 0.85 ? 14 : 0;
  const diversityBonus = candidate.tags.length >= 3 ? 8 : 0; // 多标签样本更有价值
  const positionBonus = (candidate.positionRatio > 0.1 && candidate.positionRatio < 0.9) ? 0
    : (candidate.positionRatio <= 0.05 || candidate.positionRatio >= 0.95) ? 6 : 0; // 首尾极端位置有额外价值

  return 100
    - Math.abs(candidate.content.length - targetWeight) / 8
    + (candidate.tags.length * 4)
    + tagBonus
    + diversityBonus
    + positionBonus
    - dialoguePenalty;
}
```

### 4. 采样数量提升

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

**修改 `sampleStyleExcerpts` 中的对白重限制（第 470-474 行）：**

从：
```typescript
if (candidate.dialogueRatio > 0.85 && dialogueHeavyCount >= 1) {
  return false;
}
```

改为：
```typescript
const maxDialogueHeavy = Math.max(2, Math.round(excerptCount * 0.15));
if (candidate.dialogueRatio > 0.85 && dialogueHeavyCount >= maxDialogueHeavy) {
  return false;
}
```

### 5. 在 import 阶段计算并存储 fingerprint

**修改文件：** `src/server/style/style-reference-import.ts`

在 `prepareStyleReferenceImport`（第 610-636 行）中增加 fingerprint 计算：

```typescript
import { computeStyleFingerprint, type StyleFingerprint } from "./style-fingerprint.ts";

export interface PreparedStyleReferenceImport {
  // ... 现有字段 ...
  fingerprint: StyleFingerprint;  // 新增
}

export function prepareStyleReferenceImport(input: { ... }) {
  const decoded = decodeStyleReferenceBuffer(input.buffer);
  const normalizedText = cleanImportedReferenceText(decoded.text);
  const sourceHash = createHash("sha256").update(input.buffer).digest("hex");
  const fallbackTitle = input.fileName.replace(/\.[^.]+$/u, "").trim() || "reference";
  const sections = splitStyleReferenceSections(normalizedText);
  const sampling = sampleStyleExcerpts(sourceHash, input.title?.trim() || fallbackTitle, normalizedText);
  const fingerprint = computeStyleFingerprint(normalizedText, sections);  // 新增

  return {
    // ... 现有字段 ...
    fingerprint,  // 新增
  } satisfies PreparedStyleReferenceImport;
}
```

**注意：** `splitStyleReferenceSections` 已经在 `sampleStyleExcerpts` 内部调用了一次。为避免重复计算，可以将 sections 提取到外部共用。但这是微优化，Codex 自行判断是否值得。

### 6. 更新类型定义

**修改文件：** 找到 `StyleExcerptTag` 类型定义的文件

确认现有的 `StyleExcerptTag` 类型是否已包含所有用到的标签：
```typescript
export type StyleExcerptTag =
  | "narrative" | "dialogue" | "conflict" | "emotion"
  | "mechanism" | "silence" | "pressure" | "hook";
```

如果现有类型已经包含这些值，不需要修改。

## 验证命令

```bash
cd platform
pnpm typecheck
pnpm test
pnpm build

# 确认所有关键词常量已删除（不是替换，是删除）
grep -rn "CONFLICT_KEYWORDS\|EMOTION_KEYWORDS\|MECHANISM_KEYWORDS\|MECHANISM_REVEAL\|MECHANISM_EXPLANATION\|HOOK_MARKERS\|SILENCE_MARKERS\|PRESSURE_MARKERS" src/server/style/style-reference-import.ts
# 预期为空——所有关键词常量必须不存在

# 确认洪荒词汇已清除
grep -rn "灵纹\|纹路\|印记\|禁制\|阵纹\|法门\|反噬\|血气\|铜铃\|兽道\|游开\|发麻" src/server/style/style-reference-import.ts
# 预期为空

# 确认 classifyExcerptTags 不包含任何中文词汇字面量（只有标点字符和结构检测）
grep -n "classifyExcerptTags" src/server/style/style-reference-import.ts
# 找到函数定义后，确认函数体内不含中文词汇常量

# 确认 fingerprint 模块存在
test -f src/server/style/style-fingerprint.ts && echo "OK"
test -f src/server/style/style-fingerprint.test.ts && echo "OK"

# 确认新的采样上限
grep -n "excerptCount" src/server/style/style-reference-import.ts
# 预期：8, 12, 18, 24, 30

# 确认 prepareStyleReferenceImport 返回 fingerprint
grep -n "fingerprint" src/server/style/style-reference-import.ts
# 预期：至少 3 处（import, interface, return）
```

## 约束

- 不改 `style-steering.ts`（Session S2 负责 LLM 分析重构）
- 不改 `style-snapshot.ts`（Session S2 负责编排重构）
- 不改 `author-card.service.ts`（Session S3 负责集成）
- 不改数据库 schema（Session S3 负责 fingerprint 持久化）
- 不改 test 文件中的 fixture 数据（除非类型变更导致编译错误，最小修改）
- `StyleExcerptTag` 类型不新增值（保持兼容）
- `PreparedStyleReferenceImport` 新增的 `fingerprint` 字段必须 optional 或有默认值，兼容现有调用方
