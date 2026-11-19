# Codex Prompt — Session 2B: Writer Prompt 瘦身 + Planner Prompt 升级

## 上下文

AINovel Studio（`platform/`）的 Writer prompt 被约束淹没：`prompts/writer.md` 有 52 行，其中 60%+ 是"禁写句式与 AI 味负面样例"。再加上 WritingCharter 预算表（12 项数值约束）、proseDirectives（30+ 条句法限制）、antiAiDirectives、writingDna（10 条），Writer 的注意力被分散在"不要做什么"上，没有空间"做什么"。

同时 `prompts/planner.md` 只有 11 行泛泛描述，蓝图质量直接影响首稿质量。

本 Session 精简 Writer prompt，移出约束到后处理，并升级 Planner prompt。

**重要前提：** Session 1 的注入引擎已经把 prompt 分成了 system + world-layer + structure-layer + style-anchor 四层。本 Session 修改 writer.md 和 planner.md 的内容，以及 chapter-draft.ts 中的约束注入逻辑。

## 任务

### 1. 精简 writer.md

**修改文件：** `prompts/writer.md`

**删除第 10-12 行**（句法约束：代词起句、同一主体名词连续、模板句控制）——移到 style-pass 后处理。

**删除第 17-49 行**（全部"禁写句式与 AI 味负面样例"：叠词副词、眸系描写、情感套话、对话标签、环境铺垫的负面样例）——移到 prose-normalizer 后处理。

**新版 writer.md（~15 行）：**

```markdown
你是小说主笔 Writer。

要求：
1. 严格遵循当前章节蓝图和角色卡写作。
2. 优先保证角色人设、关系、地点和时间线一致。
3. 必须严格保持项目指定的人称，不要在人称之间漂移。
4. 文风要接近提供的风格范本，正文要像真正的小说，不要像分镜或剧情总结。
5. 避免总结式旁白，通过场景、动作、细节和对话推进。
6. 段落按中文小说习惯自然组织。
7. 对话要像人说话，不同角色有不同的说话方式，参考角色卡中的说话习惯。
8. 如果上一章结尾仍处在进行中的场景，本章开头必须先承接。
9. 角色之间的关系参考"角色关系"部分，对话和互动要符合关系设定。

输出：
- 仅输出章节正文，不要加标题解释，不要加 Markdown 围栏。
```

### 2. 约束从 Writer prompt 移出

**修改文件：** `src/server/run/chapter-draft.ts`

在 `buildContextMessages()` 和/或 `buildDraftMessages()` 中：

**删除以下注入到 Writer prompt 的内容：**
- WritingCharter 预算表（strictMode 时注入的 12 项数值约束）——保留在 `chapter-style-pass.ts` 和 `chapter-audit.ts` 中用于生成后检查
- antiAiDirectives——保留在 style-pass 后处理
- writingDna 从完整 10 条缩减为最关键的 3 条（保留在 style-anchor 层）：只保留与正面风格引导相关的条目，删除所有"禁止/避免"类条目
- proseDirectives 从 30+ 条缩减为最关键的 5 条（保留在 style-anchor 层）：只保留章长约束、叙事人称约束等结构性指令，删除句法微操约束

**保留在 Writer prompt 中的约束：**
- 叙事人称（第几人称）——这是硬性约束
- 章节字数目标——Writer 需要知道写多长
- 风格画像（styleProfile）——正面引导而非负面禁止
- 风格范本（styleExemplars）——正面示范

### 3. 升级 planner.md

**修改文件：** `prompts/planner.md`

从 11 行扩充为 ~40 行的结构化模板。注意：**不写死任何题材内容**，模板对玄幻/都市/科幻/言情都通用。

```markdown
你是章节规划师 Planner。

你的任务：基于项目设定和当前进度，为指定章节设计详细的场景蓝图。

## 蓝图必须包含的核心字段

### 场景设计
- sceneGoal：本章要完成的核心叙事动作（必须是具体事件，如"主角在废墟中发现了证据并被追兵逼入绝境"，不能是"推进主线"这类抽象描述）
- entryState：章节开始时主要角色的物理位置和心理状态（必须承接上一章的 exitState）
- exitState：章节结束时角色到达的位置和状态（下一章的 entryState 从这里衔接）

### 角色动机（对每个出场角色）
- 每个角色在本场景中想要什么（motivation）
- 什么阻碍了他/她（obstacle）
- 他/她会采取什么行动（action）
如果角色之间的动机互相冲突，这就是本章的核心张力来源。

### 信息控制
- readerKnows：读者到本章开始时已经知道的关键事实
- characterKnows：主要角色到本章开始时知道/不知道的信息差
- reveal：本章需要向读者或角色揭示的新信息

### 情感弧线
- emotionalArc：本章从什么情绪到什么情绪（用具体情绪词，如"好奇 → 震惊 → 决心"，不要用"逐渐升级"）

### 标准字段
- characters：出场角色列表
- locations：地点
- conflicts：冲突（每个冲突必须涉及具体角色和具体利益碰撞）
- foreshadows：伏笔
- emotionalTone：情感基调
- estimatedWords：目标字数

## 禁止
- 不要输出空泛的 sceneGoal（如"主角变强""推进剧情""展现世界观"）
- 不要遗漏角色动机——没有动机的角色不应该出现在 characters 列表中
- conflicts 不能只是"主角遇到困难"，必须说明困难是什么、来自谁、为什么现在发生

## 输出格式
输出严格合法的 JSON，包含上述所有字段。
```

### 4. Bootstrap 温度调整

**修改文件：** `src/server/run/chapter-draft.ts`

找到 Bootstrap 模式的温度压制代码（约 `writeDraftFromContext` 函数中）：

```typescript
// 当前
temperature: useBootstrapSelection
  ? Math.min(context.agents.writer.assignment.temperature, 0.38)
  : context.agents.writer.assignment.temperature,

// 改为
temperature: useBootstrapSelection
  ? Math.min(context.agents.writer.assignment.temperature, 0.65)
  : context.agents.writer.assignment.temperature,
```

### 5. 更新蓝图相关类型（兼容新 Planner 输出）

**修改文件：** 蓝图 Zod schema（找到 blueprintSchema 定义的文件）

ChapterBlueprint 新增 optional 字段，兼容老数据：

```typescript
characterMotivations: z.array(z.object({
  name: z.string(),
  motivation: z.string(),
  obstacle: z.string(),
  action: z.string(),
})).optional(),
informationControl: z.object({
  readerKnows: z.array(z.string()).optional(),
  characterKnows: z.record(z.string(), z.string()).optional(),
  reveals: z.array(z.string()).optional(),
}).optional(),
emotionalArc: z.string().optional(),
entryState: z.string().optional(),
exitState: z.string().optional(),
```

如果 blueprintSchema 在多个文件中使用，确保都更新。

## 验证命令

```bash
cd platform
pnpm typecheck
pnpm test
pnpm build

# 确认 writer.md 行数
wc -l prompts/writer.md
# 预期 ≤ 15

# 确认 planner.md 行数
wc -l prompts/planner.md
# 预期 ~40
```

## 约束

- 不改后端 service/repository 代码（除了 chapter-draft.ts 中的注入逻辑）
- WritingCharter / prose-normalizer / style-pass / quick-audit 的后处理逻辑不改（它们仍在生成后检查）
- 蓝图新字段全部 optional（老蓝图兼容）
- 不改 test 文件中的 fixture 数据（除非类型变更导致编译错误）
