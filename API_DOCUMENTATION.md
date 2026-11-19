# AINovel Studio Backend API Contract

> 最后按代码核对时间：2026-04-12
> 代码来源：`platform/src/app/api/**/route.ts`、`platform/src/server/**`
> 覆盖范围：64 个路由文件，约 75 个 HTTP 操作；其中生产接口 73 个，演示接口 2 个
> 认证章节于 2026-11-19 更新；上面的业务接口数量不含认证端点。

这份文档是给重新做前端 UI、继续重构服务端边界、以及做后续架构规划用的后端契约说明。它以当前代码为准，不以旧版页面、旧版 API 文档或 demo mock 为准。

## 1. 接入总览

### 1.1 基础约定

- 基础前缀：`/api`
- 未设置 `AINOVEL_AUTH_SECRET` 时不强制登录。设置后使用签名 `ainovel_session` Cookie（HttpOnly、SameSite=Lax，HTTPS 下 Secure），有效期 7 天；用户数据隔离到 `tenants/u{id}`。
- `src/middleware.ts` 校验会话。缺失会话时 API 与页面均返回 `401` / `AUTH_REQUIRED`。本仓库不含登录页。
- 非 GET/HEAD/OPTIONS 请求校验 Origin；高风险接口保留额外来源检查。localhost 且无 CF-Ray 时不强制会话。
- 大多数成功响应都直接返回业务对象，不包 `data`
- 大多数错误响应都返回：

```ts
type ApiError = {
  error: string;
  code?: string;
  details?: unknown;
};
```

- Content-Type 规则：
  - 普通接口：`application/json`
  - 风格参考导入：`multipart/form-data`
  - 两个流式接口：`application/x-ndjson`


### 1.1.1 可选登录

- `POST /api/auth/login`：向 `AINOVEL_IDP_BASE/api/user/login` 校验用户名密码并签发本站会话。
- `GET /api/auth/me`：返回当前登录用户的 `id`、`username`、`role`。
- `POST /api/auth/logout`：清除本站会话。

本仓库不含 SSO 授权页、回调页或登录 UI。

### 1.2 成功响应风格

典型成功响应示例：

```json
{ "projects": [] }
```

```json
{ "project": { "id": "xxx", "title": "项目名" } }
```

```json
{
  "running": false,
  "stage": "idle",
  "currentChapter": 1,
  "totalChapters": 12
}
```

### 1.3 需要前端特别注意的事实

- 没有 `GET /api/projects/:projectId/chapters` 这个接口
  - 章节列表需要由 `GET /api/projects/:projectId` 返回的 `writtenChapters`、`blueprints`、`reviewStates`、`runState.currentChapter` 等信息拼出来
- 没有 `POST /api/projects/:projectId/chapters/:chapterNo/review`
  - 当前只有 `GET /api/projects/:projectId/chapters/:chapterNo/review`，用于拿审稿历史
- 设定工作台和文风约束支持 NDJSON 流式返回
  - 触发方式：query `?stream=1` 或 header `x-ainovel-stream: 1`
- 项目删除不是 `DELETE`
  - 软删除：`POST /api/projects/:projectId/trash`
  - 恢复：`POST /api/projects/:projectId/restore`
  - 永久删除：`POST /api/projects/:projectId/purge`
- `GET /api/settings/llm-profiles` 返回脱敏后的 `PublicLlmProfile`
  - 不含明文 `apiKey`，只有 `hasApiKey` 和 `maskedApiKey`
  - 明文 key 只能通过 save 请求写入，任何读取接口都不会回传
- 文件读取接口是 `GET /api/files/read`，并且 `start/end` 是字符偏移，不是行号
- `GET /api/files/read` 仅允许读取 `projects/<projectId>/` 内的文件
  - 推荐使用 `projectId + relativePath`；旧 `path` 参数也只接受 `projects/<projectId>/...` 或 projects 目录内绝对路径
  - `config/`、`prompts/`、`styles/` 不在该接口可达范围内
- `GET /api/demo` 和 `POST /api/demo` 只是演示/假数据入口
  - 其中 `endpoint=api-docs` 返回的 mock 清单带有过期接口名，不能当真实契约
- 章节优化接口 `POST /api/projects/:projectId/chapters/:chapterNo/optimize` 支持多种优化动作
  - 包括：`polish`、`expand`、`rewrite`、`enhance_emotion`、`add_dialogue`、`change_pov`
- 人工审阅接口 `POST /api/projects/:projectId/chapters/:chapterNo/manual-review` 支持三种动作
  - `approve_continue`：批准继续
  - `retry_chapter`：重试当前章
  - `auto_pick_version`：自动选择最佳版本

## 2. 复用数据结构

下面这些类型是 UI 重做时最常用、也最值得直接建前端类型的结构。

### 2.1 基础实体

```ts
type AgentRole = "coauthor" | "planner" | "writer" | "reviewer";

type LlmProfile = {
  id: string;
  name: string;
  providerId: string;
  protocol: "openai_compatible";
  baseUrl: string;
  apiKey: string; // 仅出现在 save 请求体中；读取接口一律返回脱敏后的 PublicLlmProfile
  defaultModel: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

// llm-profiles 读取/保存接口实际返回的脱敏视图
type PublicLlmProfile = {
  id: string;
  name: string;
  providerId: string;
  baseUrl: string;
  defaultModel: string;
  enabled: boolean;
  hasApiKey: boolean;
  maskedApiKey: string | null; // 形如 "sk-abc...wxyz"，无 key 时为 null
};

type AgentAssignmentInput = {
  role: AgentRole;
  profileId: string;
  model: string;
  temperature: number;
  maxTokens: number;
};

type ReviewPolicy = {
  cadenceChapters: number;
  deepReviewStartChapter: number;
  perChapterCheckMode: "minimal";
  forceTriggers: Array<
    | "cadence"
    | "final_chapter"
    | "completion_candidate"
    | "manual_checkpoint"
    | "hard_conflict"
    | "low_confidence"
    | "major_progression"
  >;
  manualCheckpointChapters: number[];
};

type SteeringNote = {
  id: string;
  instruction: string;
  scope: "next_arc" | "current_volume" | "persistent";
  createdAt: string;
  active: boolean;
  applyUntilChapter: number | null;
};
```

### 2.2 项目相关

```ts
type ProjectRecord = {
  id: string;
  title: string;
  genre: string;
  style: string;
  targetChapters: number;
  premise: string;
  seriesMode: "standalone" | "series";
  seriesTitle: string | null;
  seriesIndex: number | null;
  storyLength: "short" | "medium" | "long";
  narrativePerson: "first" | "third";
  chapterPlanningMode: "fixed" | "dynamic";
  paceProfile: "fast" | "medium" | "slow";
  completionCriteria: string;
  chapterBudgetMin: number;
  chapterBudgetTarget: number;
  chapterBudgetMax: number;
  hardChapterCap: number;
  reviewPolicy: ReviewPolicy;
  hasVolumes: boolean;
  plannedVolumes: number | null;
  sourceIdeaId: string | null;
  storyContract: StoryContract | null;
  steeringNotes: SteeringNote[];
  status: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type StoryContract = {
  volumes: Array<{
    volumeNo: number;
    label: string;
    goal: string;
    status: "planned" | "active" | "completed";
    chapterStart: number;
    chapterEnd: number | null;
    chapterBudgetMin: number;
    chapterBudgetTarget: number;
    chapterBudgetMax: number;
  }>;
  currentVolume: number;
  globalArc: string;
  endingPromise: string;
  completionChecks: string[];
  storyPromises: Array<{
    id: string;
    label: string;
    type: "mainline" | "relationship" | "world" | "ending";
    description: string;
  }>;
  activeProgressionAxes: string[];
  genreObligationPacks: Array<{
    id: "core-only" | "mythic_beastiary" | "romance";
    source: "auto" | "manual";
    active: boolean;
    notes: string[];
  }>;
  segmentPlans: Array<{
    id: string;
    label: string;
    startChapter: number;
    endChapter: number;
    status: "active" | "queued" | "completed";
    trigger: "seed" | "refresh";
    generatedAt: string;
    items: Array<{
      id: string;
      chapterNo: number;
      title: string;
      intent: string;
      requiredProgressDeltas: string[];
      requiredObligations: string[];
      focusCharacters: string[];
      arenaHints: string[];
      suggestedActionPattern: string | null;
      antagonistHint: string | null;
      forbiddenRecentAxes: string[];
    }>;
  }>;
  progressState: {
    latestChapter: number;
    recentPrimaryDeltas: string[];
    recentArenaKeys: string[];
    recentObjectiveKeys: string[];
    stuckDimensions: string[];
    mustAdvance: string[];
    recentAntagonistKeys: string[];
    recentActionPatterns: string[];
    recentEndingMoves: string[];
    recentMechanismRevealModes: string[];
    recentMotifWindows: string[][];
    updatedAt: string;
  };
  forecast: {
    min: number;
    target: number;
    max: number;
    finalRunReady: boolean;
    completionProgress: number;
    nextMilestone: string;
  };
  recentPlan: string[];
  updatedAt: string;
};
```

### 2.3 想法、作者卡、设定

```ts
type IdeaRecord = {
  id: string;
  title: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type FoundationWorkshopDraft = {
  premise: string;
  mainline: string;
  storyHook: string;
  desiredTone: string;
  characterIdeas: CharacterCard[];
  worldviewIdeas: WorldRule[];
  relationshipIdeas: RelationshipEdge[];
  unresolvedQuestions: string[];
  styleReferences?: StyleReferenceSelection[];
  styleSamples?: string[];
  styleManualGuidance?: string;
  styleAvoidances?: string;
  styleSteeringCard?: string;
  styleProfile?: StyleProfile;
  styleSnapshotId?: string | null;
  styleSnapshotVersion?: number | null;
  styleDigest?: string;
  styleExemplars?: StyleExcerpt[];
};

type CharacterCard = {
  name: string;
  role: string;
  goal: string;
  traits: string[];
  secrets?: string[];
};

type WorldRule = {
  name: string;
  description: string;
};

type RelationshipEdge = {
  source: string;
  target: string;
  label: string;
};

type FoundationPayload = {
  premise: string;
  styleCard: string;
  styleProfile?: StyleProfile;
  styleSnapshotId?: string | null;
  styleSnapshotVersion?: number | null;
  styleDigest?: string;
  styleExemplars?: StyleExcerpt[];
  characters: CharacterCard[];
  worldview: WorldRule[];
  relationships: RelationshipEdge[];
};

type StyleReferenceSelection = {
  kind: "book" | "author";
  label: string;
  author?: string;
  source: "network" | "ai_fallback";
  relation: "primary" | "secondary";
};

type StyleReferenceCandidate = {
  id: string;
  kind: "book" | "author";
  label: string;
  author?: string;
  source: "network" | "ai_fallback";
  hint: string;
  origin?: string;
};

type StyleExcerpt = {
  id: string;
  sourceId: string;
  sourceTitle: string;
  label: string;
  tags: Array<
    "narrative" | "dialogue" | "conflict" | "emotion" | "mechanism" | "hook" | "silence" | "pressure"
  >;
  content: string;
  wordCount: number;
  startOffset: number;
  endOffset: number;
  positionRatio: number;
  dialogueRatio: number;
};

type StyleProfile = {
  referenceAnchor: { primary: string; secondary: string[] };
  paragraphCadence: { narrativeRule: string; dialogueRule: string; emphasisRule: string };
  sentenceRhythm: { pacingRule: string; transitionRule: string; pauseRule: string };
  narrativeDistance: { intimacyRule: string; expositionRule: string; textureRule: string };
  dialogueStyle: { voiceRule: string; subtextRule: string; distinctionRule: string };
  imageryRegister: { densityRule: string; textureRule: string; avoid: string[] };
  forbiddenLexicon: string[];
  toneGuardrails: string[];
  openingStrategy: string;
  infoRevealRule: string;
  emotionRenderingRule: string;
  chapterClosureRule: string;
  writingCharter?: unknown;
  aiSmellPatterns: string[];
  styleTaboos: string[];
};

type StyleReferenceImport = {
  id: string;
  projectId: string;
  title: string;
  author?: string;
  originalFileName: string;
  mediaType: string;
  sourceHash: string;
  rawFilePath: string;
  normalizedFilePath: string;
  wordCount: number;
  encoding: string;
  confidence: "low" | "medium" | "high";
  chapterCount: number;
  excerpts: StyleExcerpt[];
  createdAt: string;
};

type StyleCardSnapshot = {
  id: string;
  projectId: string;
  mode: "book" | "author";
  sourceIds: string[];
  styleCard: string;
  styleProfile: StyleProfile;
  styleDigest: string;
  styleExemplars: StyleExcerpt[];
  sampledExcerpts: StyleExcerpt[];
  confidence: "low" | "medium" | "high";
  version: number;
  createdAt: string;
};

type AuthorCardRecord = {
  id: string;
  displayName: string;
  normalizedName: string;
  archivedAt: string | null;
  latestVersion: number | null;
  versionCount: number;
  latestConfidence: "low" | "medium" | "high" | null;
  latestCreatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type AuthorCardVersionRecord = {
  id: string;
  authorCardId: string;
  version: number;
  styleCard: string;
  styleProfile: StyleProfile;
  styleDigest: string;
  styleExemplars: StyleExcerpt[];
  sampledExcerpts: StyleExcerpt[];
  confidence: "low" | "medium" | "high";
  sourceWorks: Array<{
    title: string;
    author: string;
    projectId?: string | null;
    snapshotId?: string | null;
  }>;
  createdAt: string;
};
```

### 2.4 蓝图、章节、卡片、运行态

```ts
type ChapterBlueprint = {
  chapterNo: number;
  sceneGoal: string;
  characters: string[];
  locations: string[];
  conflicts: string[];
  foreshadows: string[];
  emotionalTone: string;
  estimatedWords: number;
  segmentId?: string | null;
  segmentItemId?: string | null;
  requiredProgressDelta?:
    | "situation_shift"
    | "objective_shift"
    | "information_shift"
    | "relationship_shift"
    | "power_shift"
    | "world_shift"
    | "cost_shift";
  actionPattern?: string;
  antagonistHint?: string;
};

type ChapterVersionRecord = {
  id: string;
  projectId: string;
  chapterNo: number;
  versionNo: number;
  temperature: number;
  path: string;
  excerpt: string;
  selected: boolean;
  source: string;
  createdAt: string;
};

type ChapterInvalidationRecord = {
  id: string;
  projectId: string;
  chapterNo: number;
  rangeStartChapter: number;
  rangeEndChapter: number;
  reason: string;
  archivedPath: string;
  excerpt: string;
  reviewReason: string | null;
  invalidatedAt: string;
};

type ChapterReviewState = {
  projectId: string;
  chapterNo: number;
  status: "provisional" | "deep_locked" | "manual_review";
  quickCheckedAt: string | null;
  deepCheckedAt: string | null;
  openWindowId: string | null;
  lastReviewMode: "quick" | "deep" | null;
  latestConfidence: number;
  earliestAffectedChapter: number | null;
  updatedAt: string;
};

type ReviewReportRecord = {
  id: string;
  projectId: string;
  chapterNo: number;
  verdict: "pass" | "escalate" | "rewrite_current" | "manual_review_window";
  reviewMode: "quick" | "deep";
  confidence: number;
  reason: string;
  fixInstructions: string;
  issues: Array<{ type: string; location: string; severity: "minor" | "major" }>;
  triggerReasons: string[];
  styleChecklistHits: Array<{ dimension: string; description: string; severity: "minor" | "major" }>;
  charterViolations: unknown[];
  storyProgression: {
    risk: "pass" | "watch" | "risk";
    score: number;
    summary: string;
    advancements: string[];
    stallSignals: string[];
    primaryDelta: string | null;
    deliveredDeltas: string[];
  };
  genreFulfillment: {
    risk: "pass" | "watch" | "risk";
    score: number;
    summary: string;
    present: string[];
    missing: string[];
    activePacks: string[];
  } | null;
  loopRisk: {
    risk: "pass" | "watch" | "risk";
    score: number;
    summary: string;
    repetitionAxes: string[];
    stuckDimensions: string[];
  };
  plannerQuality: unknown | null;
  primaryDeltaDelivered: string | null;
  stuckDimensions: string[];
  windowStartChapter: number | null;
  windowEndChapter: number | null;
  earliestAffectedChapter: number | null;
  path: string;
  createdAt: string;
};

type CanonFact = {
  id: string;
  type:
    | "character_state"
    | "location_change"
    | "item_acquired"
    | "plot_event"
    | "foreshadow"
    | "world_rule"
    | "relationship"
    | "timeline_marker";
  chapterNo: number;
  content: string;
  metadata: Record<string, unknown>;
  timestamp: string;
  keywords: string[];
};

type ConflictRecord = {
  id: string;
  type: string;
  severity: "error" | "warning" | "hint";
  message: string;
  resolution?: "ignore" | "fix";
  note?: string;
  chapterNo?: number;
};

type PatchOperation = {
  type: "replace" | "insert" | "delete";
  range?: { start: number; end: number };
  text?: string;
};

type EditorPatch = {
  operations: PatchOperation[];
  summary: string;
};

type ProjectCard = {
  id: string;
  projectId: string;
  cardType: "character" | "world";
  name: string;
  draft: Record<string, unknown>;
  meta: {
    aliases: string[];
    keywords: string[];
    priority: number;
    pinnedScope: "none" | "global" | "chapter";
    linkedCardIds: string[];
    enabled: boolean;
    origin?: "manual" | "foundation" | "auto_blueprint";
    importance?: "important" | "super_key";
    discoveryStage?: "first_seen" | "repeated_blueprint" | "auto_confirmed";
    evidence?: Array<{
      chapterNo: number;
      source:
        | "blueprint.characters"
        | "blueprint.sceneGoal"
        | "blueprint.conflicts"
        | "blueprint.foreshadows"
        | "chapter.facts"
        | "chapter.snapshot";
      reason: string;
      snippet: string;
    }>;
  };
  status: "draft" | "confirmed";
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type CardMessage = {
  id: string;
  cardId: string;
  projectId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

type CardProgression = {
  id: string;
  projectId: string;
  cardId: string;
  chapterNo: number;
  targetPath: string;
  mode: "add" | "replace" | "remove" | "resolve";
  content: string;
  sourceFactIds: string[];
  status: "active" | "resolved" | "superseded";
  reviewState: "provisional" | "confirmed";
  createdAt: string;
  updatedAt: string;
};

type RunProgressPayload = {
  running: boolean;
  stage:
    | "idle"
    | "blueprint"
    | "context"
    | "writing"
    | "style_pass"
    | "review"
    | "analysis"
    | "completed"
    | "manual_review"
    | "paused"
    | "interrupted"
    | "failed";
  currentChapter: number;
  totalChapters: number;
  retryCount: number;
  confidence: number;
  draftFile?: string;
  currentPosition?: number;
  wordCount?: number;
  stageDetails: Record<string, unknown>;
  planningMode?: "fixed" | "dynamic";
  currentVolume?: number;
  hardChapterCap?: number;
  forecastRange?: { min: number; target: number; max: number };
  completionProgress?: number;
  nextPlan?: string[];
  error?: string;
  desiredState?: "idle" | "running" | "paused" | "stopped";
  heartbeatAt?: string | null;
  heartbeatAgeMs?: number | null;
  staleHeartbeat?: boolean;
  lastActiveStage?: "blueprint" | "context" | "writing" | "style_pass" | "review" | "analysis" | null;
  logs: Array<{ level: string; message: string; createdAt: string }>;
};

type RunSessionLifecycleStatus =
  | "queued"
  | "launching"
  | "running"
  | "recovering"
  | "paused"
  | "interrupted"
  | "completed"
  | "failed"
  | "stopped";

type RunProgressView = RunProgressPayload & {
  sessionId?: string;
  lifecycleStatus?: RunSessionLifecycleStatus;
  recoverable?: boolean;
};

type NovelExportRecord = {
  exists: boolean;
  status: "ready" | "failed" | "pending";
  path?: string;
  generatedAt?: string;
  chapterCount?: number;
  error?: string;
};

type NovelPreviewPayload = {
  title: string;
  format: "txt" | "md";
  generatedAt: string;
  chapterCount: number;
  chapterNos: number[];
  missingChapterNos: number[];
  suggestedFileName: string;
  content: string;
  sections: Array<{
    chapterNo: number;
    heading: string;
    paragraphs: string[];
  }>;
};
```

## 3. 接口清单

## 3.1 模型配置

### `GET /api/settings/llm-profiles`

- 用途：读取全部模型配置
- 请求体：无
- 注意：返回脱敏后的 `PublicLlmProfile[]`，不含明文 `apiKey`
- 响应：

```ts
{ profiles: PublicLlmProfile[] }
```

- 常见错误：`500`

### `POST /api/settings/llm-profiles/save`

- 用途：新增或更新单个模型配置
- 请求体：

```ts
Partial<LlmProfile>
```

- 实际必填字段至少应包含：`baseUrl`、`apiKey`、`name`、`defaultModel`
- 响应：

```ts
{ profile: PublicLlmProfile }
```

- 常见错误：`400`

### `POST /api/settings/llm-profiles/test`

- 用途：测试配置连通性
- 请求体：

```ts
{
  profileId?: string;
  profile?: {
    id?: string;
    name?: string;
    providerId?: string;
    protocol?: "openai_compatible";
    baseUrl: string;
    apiKey: string;
    defaultModel?: string;
    enabled?: boolean;
  };
  model?: string;
}
```

- 说明：
  - `profileId` 和 `profile` 二选一
  - 如果 `model` 为空，会优先用 `defaultModel`，再尝试自动拉取模型列表
- 响应：

```ts
{
  ok: true;
  model: string;
  preview: string;
}
```

- 常见错误：`400`

### `POST /api/settings/llm-profiles/fetch-models`

- 用途：拉取某个配置可用的模型列表
- 请求体：

```ts
{
  profileId?: string;
  profile?: {
    id?: string;
    name?: string;
    providerId?: string;
    protocol?: "openai_compatible";
    baseUrl: string;
    apiKey: string;
    defaultModel?: string;
    enabled?: boolean;
  };
}
```

- 响应：

```ts
{ models: string[] }
```

- 常见错误：`400`

## 3.2 想法区

### `GET /api/ideas`

- 用途：读取未删除想法列表
- 响应：

```ts
{
  ideas: Array<{
    idea: IdeaRecord;
    preview: string;
    updatedAt: string;
    projectCount: number;
  }>;
}
```

### `POST /api/ideas`

- 用途：新建想法
- 请求体：

```ts
{
  title?: string;
}
```

- 响应：

```ts
{
  idea: {
    idea: IdeaRecord;
    preview: string;
    updatedAt: string;
    projectCount: number;
  };
}
```

### `GET /api/ideas/trash`

- 用途：读取想法回收站
- 响应同 `GET /api/ideas`

### `GET /api/ideas/:ideaId`

- 用途：读取单个想法详情
- 路径参数：`ideaId`
- 响应：

```ts
{
  idea: IdeaRecord;
  state: {
    ideaId: string;
    draft: FoundationWorkshopDraft;
    updatedAt: string;
  } | null;
  messages: Array<{
    id: string;
    ideaId: string;
    role: "assistant" | "user";
    content: string;
    createdAt: string;
  }>;
  projects: ProjectRecord[];
}
```

- 可能错误：`404`、`500`

### `PUT /api/ideas/:ideaId`

- 用途：修改想法标题或删除状态
- 请求体：

```ts
{
  title?: string;
  deleted?: boolean;
}
```

- 说明：至少传一个字段
- 响应：

```ts
{ idea: { idea: IdeaRecord; preview: string; updatedAt: string; projectCount: number } | null }
```

- 常见错误：`400`

### `GET /api/ideas/:ideaId/workshop`

- 用途：读取想法共创区快照
- 响应：

```ts
{
  idea: IdeaRecord;
  state: {
    ideaId: string;
    draft: FoundationWorkshopDraft;
    updatedAt: string;
  } | null;
  messages: Array<{
    id: string;
    ideaId: string;
    role: "assistant" | "user";
    content: string;
    createdAt: string;
  }>;
}
```

### `POST /api/ideas/:ideaId/workshop`

- 用途：向想法共创区发消息
- 请求体：

```ts
{
  message: string;
  baseUpdatedAt?: string;
}
```

- 说明：
  - `baseUpdatedAt` 用于并发保护
  - 如果当前草稿已被其他页面改动，会返回 `409`
- 响应：

```ts
{
  assistant: {
    id: string;
    ideaId: string;
    role: "assistant";
    content: string;
    createdAt: string;
  };
  state: {
    ideaId: string;
    draft: FoundationWorkshopDraft;
    updatedAt: string;
  };
  nextFocus: string;
}
```

- 常见错误：`400`、`409`

### `POST /api/ideas/:ideaId/projects`

- 用途：基于想法创建项目
- 请求体：与 `POST /api/projects` 基本一致，只是 `style`、`premise` 可缺省

```ts
{
  title: string;
  genre: string;
  style?: string;
  seriesMode: "standalone" | "series";
  seriesTitle?: string;
  seriesIndex?: number;
  storyLength: "short" | "medium" | "long";
  narrativePerson?: "first" | "third";
  hasVolumes?: boolean;
  plannedVolumes?: number;
  chapterPlanningMode?: "fixed" | "dynamic";
  paceProfile?: "fast" | "medium" | "slow";
  completionCriteria?: string;
  chapterBudgetMin?: number;
  chapterBudgetTarget?: number;
  chapterBudgetMax?: number;
  hardChapterCap?: number;
  targetChapters?: number;
  premise?: string;
  assignments: AgentAssignmentInput[];
  reviewPolicy?: Partial<ReviewPolicy>;
}
```

- 响应：

```ts
{ project: ProjectRecord }
```

- 常见错误：`400`

## 3.3 作者卡库

### `GET /api/authors`

- 用途：读取全局作者卡列表
- 响应：

```ts
{ authors: AuthorCardRecord[] }
```

### `POST /api/authors`

- 用途：把项目中的 style snapshot 归档到全局作者卡库
- 请求体：

```ts
{
  projectId: string;
  snapshotId: string;
  authorName: string;
  conflictResolution?: "auto" | "merge_existing" | "create_independent" | "cancel";
  existingCardId?: string;
}
```

- 响应：

```ts
{
  result:
    | { status: "created" | "merged"; card: AuthorCardRecord; version: AuthorCardVersionRecord | null }
    | { status: "conflict"; normalizedName: string; candidates: AuthorCardRecord[] }
    | { status: "cancelled" }
    | { status: "skipped"; reason: string };
}
```

### `GET /api/authors/:authorCardId`

- 用途：读取作者卡详情
- 响应：

```ts
{
  card: AuthorCardRecord;
  versions: AuthorCardVersionRecord[];
}
```

- 可能错误：`404`、`500`

## 3.4 项目

### `GET /api/projects`

- 用途：读取项目列表
- 响应：

```ts
{ projects: ProjectRecord[] }
```

### `POST /api/projects`

- 用途：新建项目
- 请求体：

```ts
{
  title: string;
  genre: string;
  style: string;
  seriesMode: "standalone" | "series";
  seriesTitle?: string;
  seriesIndex?: number;
  storyLength: "short" | "medium" | "long";
  narrativePerson?: "first" | "third";
  hasVolumes?: boolean;
  plannedVolumes?: number;
  chapterPlanningMode?: "fixed" | "dynamic";
  paceProfile?: "fast" | "medium" | "slow";
  completionCriteria?: string;
  chapterBudgetMin?: number;
  chapterBudgetTarget?: number;
  chapterBudgetMax?: number;
  hardChapterCap?: number;
  targetChapters?: number;
  premise: string;
  assignments: AgentAssignmentInput[];
  reviewPolicy?: Partial<ReviewPolicy>;
}
```

- 重要校验：
  - `assignments` 必须一次性传齐四个角色：`coauthor / planner / writer / reviewer`
  - `storyLength = short` 时强制按固定章节处理
  - 动态模式下必须给出 `plannedVolumes`、`completionCriteria`、`hardChapterCap`
  - 固定章节模式下必须给出 `targetChapters`
- 响应：

```ts
{ project: ProjectRecord }
```

- 常见错误：`400`

### `GET /api/projects/trash`

- 用途：读取项目回收站
- 响应：

```ts
{ projects: ProjectRecord[] }
```

### `GET /api/projects/:projectId`

- 用途：读取项目详情页所需的聚合数据
- 响应：

```ts
{
  project: ProjectRecord;
  storyContract: StoryContract | null;
  steeringNotes: SteeringNote[];
  resolvedReviewPolicy: ReviewPolicy;
  assignments: AgentAssignmentInput[];
  foundation: FoundationPayload | null;
  foundationLocked: boolean;
  foundationWorkshop: {
    projectId: string;
    draft: FoundationWorkshopDraft;
    readyToGenerate: boolean;
    updatedAt: string;
  } | null;
  runState: {
    projectId: string;
    status: string;
    stage: string;
    desiredState: "idle" | "running" | "paused" | "stopped";
    runSessionId: string | null;
    heartbeatAt: string | null;
    currentChapter: number;
    totalChapters: number;
    retryCount: number;
    confidence: number;
    lastError: string | null;
    draftFile: string | null;
    currentPosition: number;
    wordCount: number;
    stageDetails: Record<string, unknown>;
    startedAt: string;
    updatedAt: string;
  } | null;
  blueprints: number[];
  recentReviews: ReviewReportRecord[];
  reviewStates: ChapterReviewState[];
  invalidatedHistory: ChapterInvalidationRecord[];
  conflicts: Array<ConflictRecord & { chapterNo: number }>;
  logs: Array<{ level: string; message: string; createdAt: string }>;
  sourceIdea: null | {
    id: string;
    title: string;
    deletedAt: string | null;
    updatedAt: string;
    draft: FoundationWorkshopDraft | null;
  };
  novelExport: NovelExportRecord;
  writtenChapters: number[];
}
```

- 可能错误：`404`、`500`

### `PUT /api/projects/:projectId`

- 用途：更新项目设置
- 当前只支持更新两类字段：

```ts
{
  reviewPolicy?: Partial<ReviewPolicy>;
  narrativePerson?: "first" | "third";
}
```

- 响应：

```ts
{ project: ProjectRecord }
```

- 常见错误：`400`

### `GET /api/projects/:projectId/assignments`

- 用途：读取项目角色分配
- 响应：

```ts
{ assignments: AgentAssignmentInput[] }
```

### `PUT /api/projects/:projectId/assignments`

- 用途：更新项目角色分配
- 请求体：

```ts
{ assignments: AgentAssignmentInput[] }
```

- 响应：

```ts
{ ok: true; assignments: AgentAssignmentInput[] }
```

- 常见错误：`400`

### `POST /api/projects/:projectId/trash`

- 用途：软删除项目
- 请求体：无
- 响应：

```ts
{ ok: true }
```

- 常见错误：`400`
- 注意：运行中的项目不能删除

### `POST /api/projects/:projectId/restore`

- 用途：恢复回收站项目
- 响应：

```ts
{ project: ProjectRecord }
```

### `POST /api/projects/:projectId/purge`

- 用途：永久删除项目
- 响应：

```ts
{ ok: true }
```

- 注意：只有回收站中的项目才能 purge

### `GET /api/projects/:projectId/manuscript-preview`

- 用途：读取合卷预览
- Query：

```ts
{
  format?: "txt" | "md"; // 默认 md
}
```

- 响应：

```ts
NovelPreviewPayload
```

### `POST /api/projects/:projectId/steering-notes`

- 用途：追加运行期指导指令
- 请求体：

```ts
{
  instruction: string;
  scope?: "next_arc" | "current_volume" | "persistent";
}
```

- 响应：

```ts
{
  note: SteeringNote;
  activeNotes: SteeringNote[];
}
```

- 常见错误：`400`

## 3.5 设定工作台与文风系统

### `GET /api/projects/:projectId/foundation/workshop`

- 用途：读取设定工作台快照
- 响应：

```ts
{
  project: ProjectRecord;
  state: {
    projectId: string;
    draft: FoundationWorkshopDraft;
    readyToGenerate: boolean;
    updatedAt: string;
  } | null;
  stylePanelUnlocked: true;
  canGenerateFoundation: boolean;
  readinessHint: string;
  messages: Array<{
    id: string;
    projectId: string;
    role: "assistant" | "user";
    content: string;
    createdAt: string;
  }>;
}
```

### `POST /api/projects/:projectId/foundation/workshop`

- 用途：向设定工作台发消息
- 请求体：

```ts
{ message: string }
```

- 非流式响应：

```ts
{
  assistant: {
    id: string;
    projectId: string;
    role: "assistant";
    content: string;
    createdAt: string;
  };
  state: {
    projectId: string;
    draft: FoundationWorkshopDraft;
    readyToGenerate: boolean;
    updatedAt: string;
  };
  nextFocus: string;
}
```

- 流式模式：
  - 触发方式：query `?stream=1` 或 header `x-ainovel-stream: 1`
  - 返回：`application/x-ndjson`
  - 事件：

```ts
type FoundationWorkshopStreamEvent =
  | { type: "status"; stage: "context" | "replying" | "draft_sync"; progress: number; message: string }
  | { type: "assistant_delta"; delta: string; progress: number; replace?: boolean }
  | { type: "final"; progress: 100; nextFocus: string; state: { projectId: string; draft: FoundationWorkshopDraft; readyToGenerate: boolean; updatedAt: string } }
  | { type: "error"; error: string };
```

### `POST /api/projects/:projectId/foundation/generate`

- 用途：把工作台草稿整理成正式设定
- 响应：

```ts
{ foundation: FoundationPayload }
```

- 常见错误：`400`

### `POST /api/projects/:projectId/foundation/lock`

- 用途：锁定正式设定，自动写作前置条件之一
- 响应：

```ts
{ ok: true }
```

- 常见错误：`400`

### `GET /api/projects/:projectId/foundation/style-search`

- 用途：搜索文风参考候选
- Query：

```ts
{ query: string }
```

- 响应：

```ts
{
  candidates: StyleReferenceCandidate[];
  source: "mixed" | "network" | "ai_fallback";
}
```

### `PUT /api/projects/:projectId/foundation/workshop/style-steering`

- 用途：更新文风约束、参考作品和手工偏好
- 请求体：

```ts
{
  references: Array<{
    kind: "book" | "author";
    label: string;
    author?: string;
    source: "network" | "ai_fallback";
    relation: "primary" | "secondary";
  }>; // 1~3 项，且必须 1 个 primary，最多 2 个 secondary
  samples?: string[]; // 最多 3 段
  manualGuidance?: string;
  avoidances?: string;
}
```

- 非流式响应：

```ts
{
  state: {
    projectId: string;
    draft: FoundationWorkshopDraft;
    readyToGenerate: boolean;
    updatedAt: string;
  } | null;
  styleSteeringCard: string;
}
```

- 流式模式：
  - 触发方式：query `?stream=1` 或 header `x-ainovel-stream: 1`
  - 事件：

```ts
type FoundationStyleSteeringStreamEvent =
  | { type: "status"; stage: "context" | "analysis" | "drafting"; progress: number; message: string }
  | { type: "style_delta"; delta: string; progress: number; replace?: boolean }
  | { type: "final"; progress: 100; styleSteeringCard: string; state: { projectId: string; draft: FoundationWorkshopDraft; readyToGenerate: boolean; updatedAt: string } | null }
  | { type: "error"; error: string };
```

### `GET /api/projects/:projectId/foundation/style-imports`

- 用途：读取已导入的文风参考文件
- 响应：

```ts
{ imports: StyleReferenceImport[] }
```

### `POST /api/projects/:projectId/foundation/style-imports`

- 用途：导入本地文风参考文件
- Content-Type：`multipart/form-data`
- 表单字段：

```ts
{
  file: File;       // 仅支持 .txt / .md
  title?: string;
  author?: string;
}
```

- 响应：

```ts
{ import: StyleReferenceImport }
```

- 常见错误：`400`

### `GET /api/projects/:projectId/foundation/style-snapshots`

- 用途：读取 style snapshot 列表
- 响应：

```ts
{ snapshots: StyleCardSnapshot[] }
```

### `POST /api/projects/:projectId/foundation/style-snapshots`

- 用途：基于导入源生成 style snapshot
- 请求体：

```ts
{
  mode: "book" | "author";
  sourceIds: string[]; // 至少 1 个
}
```

- 响应：

```ts
{
  snapshot: StyleCardSnapshot;
  authorCardSync:
    | null
    | { status: "created" | "merged"; card: AuthorCardRecord; version: AuthorCardVersionRecord | null }
    | { status: "conflict"; normalizedName: string; candidates: AuthorCardRecord[] }
    | { status: "cancelled" }
    | { status: "skipped"; reason: string };
}
```

- 说明：当 `mode = "author"` 时，服务端会尝试自动同步到全局作者卡库

### `POST /api/projects/:projectId/foundation/style-snapshots/:snapshotId/apply`

- 用途：把指定 snapshot 应用到当前项目
- 响应：

```ts
{
  snapshot: StyleCardSnapshot;
  foundation: FoundationPayload | null;
  workshopState: {
    projectId: string;
    draft: FoundationWorkshopDraft;
    readyToGenerate: boolean;
    updatedAt: string;
  } | null;
}
```

### `POST /api/projects/:projectId/foundation/author-cards`

- 用途：手动把项目内 snapshot 同步到全局作者卡库
- 请求体：

```ts
{
  snapshotId: string;
  authorName: string;
  conflictResolution?: "auto" | "merge_existing" | "create_independent" | "cancel";
  existingCardId?: string;
}
```

- 响应：

```ts
{
  result:
    | { status: "created" | "merged"; card: AuthorCardRecord; version: AuthorCardVersionRecord | null }
    | { status: "conflict"; normalizedName: string; candidates: AuthorCardRecord[] }
    | { status: "cancelled" }
    | { status: "skipped"; reason: string };
}
```

### `POST /api/projects/:projectId/foundation/author-cards/:authorCardId/apply`

- 用途：把全局作者卡应用到项目
- 响应：

```ts
{
  authorCard: AuthorCardRecord;
  authorCardVersion: AuthorCardVersionRecord;
  snapshot: StyleCardSnapshot;
  applied: {
    snapshot: StyleCardSnapshot;
    foundation: FoundationPayload | null;
    workshopState: {
      projectId: string;
      draft: FoundationWorkshopDraft;
      readyToGenerate: boolean;
      updatedAt: string;
    } | null;
  };
}
```

## 3.6 蓝图

### `POST /api/projects/:projectId/blueprints/generate`

- 用途：生成指定章节蓝图；如果已存在则直接返回已有蓝图
- 请求体：

```ts
{
  chapterNo?: number; // 默认 1
}
```

- 响应：

```ts
{ blueprint: ChapterBlueprint }
```

- 常见错误：`400`
- 前置条件：项目必须已有正式设定且已锁定

### `GET /api/projects/:projectId/blueprints/:chapterNo`

- 用途：读取单章蓝图
- 响应：

```ts
{ blueprint: ChapterBlueprint }
```

- 常见错误：`404`、`500`

### `PUT /api/projects/:projectId/blueprints/:chapterNo`

- 用途：手工保存蓝图
- 请求体：

```ts
{
  sceneGoal: string;
  characters: string[];
  locations: string[];
  conflicts: string[];
  foreshadows?: string[];
  emotionalTone: string;
  estimatedWords: number;
  segmentId?: string | null;
  segmentItemId?: string | null;
  requiredProgressDelta?:
    | "situation_shift"
    | "objective_shift"
    | "information_shift"
    | "relationship_shift"
    | "power_shift"
    | "world_shift"
    | "cost_shift";
}
```

- 响应：

```ts
{ ok: true }
```

## 3.7 章节、版本、审稿

### `GET /api/projects/:projectId/chapters/:chapterNo`

- 用途：读取章节工作台聚合数据
- 响应：

```ts
{
  chapterNo: number;
  content: string | null;
  blueprint: ChapterBlueprint | null;
  versions: ChapterVersionRecord[];
  reviews: ReviewReportRecord[];
  invalidatedHistory: ChapterInvalidationRecord[];
  reviewState: ChapterReviewState | null;
  liveDraft: {
    content: string;
    completed: boolean;
  } | null;
  run: {
    running: boolean;
    stage: RunProgressPayload["stage"];
    currentChapter: number;
    currentPosition: number;
    wordCount: number;
    isCurrentChapter: boolean;
    isStreaming: boolean;
  };
  manualReview: {
    awaiting: boolean;
    reason: string | null;
    canApprove: boolean;
    canAutoPick: boolean;
    isLastChapter: boolean;
    earliestAffectedChapter: number | null;
    requiresWindowRestart: boolean;
  };
}
```

### `GET /api/projects/:projectId/chapters/:chapterNo/review`

- 用途：读取该章审稿报告列表
- 响应：

```ts
{ reviews: ReviewReportRecord[] }
```

### `POST /api/projects/:projectId/chapters/:chapterNo/manual-review`

- 用途：处理人工审阅动作
- 请求体：

```ts
{
  action: "approve_continue" | "retry_chapter" | "auto_pick_version";
}
```

- 响应：

```ts
RunProgressView
```

- 常见错误：`400`

### `POST /api/projects/:projectId/chapters/:chapterNo/generate-versions`

- 用途：基于当前正文生成 3 个候选版本
- 请求体：无
- 响应：

```ts
{
  versions: Array<{
    id: string;
    versionNo: number;
    temperature: number;
    path: string;
    excerpt: string;
  }>;
}
```

### `GET /api/projects/:projectId/chapters/:chapterNo/versions`

- 用途：读取版本列表
- 响应：

```ts
{ versions: ChapterVersionRecord[] }
```

### `POST /api/projects/:projectId/chapters/:chapterNo/rollback`

- 用途：把章节正文切换到指定版本
- 请求体：

```ts
{ versionId: string }
```

- 响应：

```ts
{
  version: ChapterVersionRecord & {
    invalidatedTimeline:
      | null
      | {
          startChapter: number;
          endChapter: number;
          invalidatedChapters: number[];
        };
  };
}
```

- 说明：如果回滚改变了当前章正文，后续章节会被自动失效归档

### `POST /api/projects/:projectId/chapters/:chapterNo/optimize`

- 用途：对正文局部生成编辑补丁
- 请求体：

```ts
{
  selection: {
    start: number;
    end: number;
  };
  action: "polish" | "expand" | "rewrite" | "enhance_emotion" | "add_dialogue" | "change_pov";
}
```

- 响应：

```ts
{
  patchId: string;
  patch: EditorPatch;
  preview: string;
}
```

### `POST /api/projects/:projectId/chapters/:chapterNo/apply-patch`

- 用途：应用编辑补丁
- 请求体：

```ts
{
  patchId?: string;
  patch?: EditorPatch;
}
```

- 说明：`patchId` 和 `patch` 至少提供一个
- 响应：

```ts
{
  versionId: string;
  content: string;
  invalidatedTimeline:
    | null
    | {
        startChapter: number;
        endChapter: number;
        invalidatedChapters: number[];
      };
}
```

### `POST /api/projects/:projectId/chapters/delete-range`

- 用途：删除一段章节及其衍生产物
- 请求体：

```ts
{
  startChapter: number;
  endChapter: number;
}
```

- 响应：

```ts
RunProgressView
```

- 常见错误：`400`
- 注意：自动写作进行中不能删，必须先暂停

## 3.8 卡片库

### `GET /api/projects/:projectId/cards`

- 用途：读取项目卡片库
- 附带行为：会先尝试把正式设定里的角色/世界条目自动导入为已确认卡片
- 响应：

```ts
{
  cards: ProjectCard[];
  importResult: {
    imported: number;
    skipped: number;
  };
}
```

### `POST /api/projects/:projectId/cards`

- 用途：创建卡片
- 请求体：

```ts
{
  cardType: "character" | "world";
  name: string;
  draft?: Record<string, unknown>;
  meta?: {
    aliases?: string[];
    keywords?: string[];
    priority?: number;
    pinnedScope?: "none" | "global" | "chapter";
    linkedCardIds?: string[];
    enabled?: boolean;
  };
}
```

- 响应：

```ts
{ card: ProjectCard }
```

### `GET /api/projects/:projectId/cards/:cardId`

- 用途：读取单张卡片及共创消息
- 响应：

```ts
{
  card: ProjectCard;
  messages: CardMessage[];
}
```

- 常见错误：`404`、`403`、`400`

### `PATCH /api/projects/:projectId/cards/:cardId`

- 用途：更新卡片
- 请求体：

```ts
{
  name?: string;
  draft?: Record<string, unknown>;
  meta?: {
    aliases?: string[];
    keywords?: string[];
    priority?: number;
    pinnedScope?: "none" | "global" | "chapter";
    linkedCardIds?: string[];
    enabled?: boolean;
  };
}
```

- 响应：

```ts
{ card: ProjectCard }
```

### `DELETE /api/projects/:projectId/cards/:cardId`

- 用途：删除卡片
- 响应：

```ts
{ ok: true }
```

### `GET /api/projects/:projectId/cards/:cardId/progressions`

- 用途：读取卡片推进历史
- 响应：

```ts
{ progressions: CardProgression[] }
```

### `POST /api/projects/:projectId/cards/:cardId/confirm`

- 用途：确认或取消确认卡片
- 请求体：

```ts
{
  action: "confirm" | "unconfirm";
}
```

- 响应：

```ts
{ card: ProjectCard }
```

### `POST /api/projects/:projectId/cards/:cardId/workshop`

- 用途：卡片共创
- 请求体：

```ts
{ message: string }
```

- 响应：

```ts
{
  assistant: CardMessage;
  updatedDraft: Record<string, unknown>;
}
```

## 3.9 事实表与运行控制

### `GET /api/projects/:projectId/canon/facts`

- 用途：读取事实表
- Query：

```ts
{
  chapterNo?: string;
  type?: string;
  keyword?: string;
}
```

- 响应：

```ts
{ facts: CanonFact[] }
```

### `GET /api/projects/:projectId/canon/conflicts`

- 用途：读取冲突列表
- 响应：

```ts
{ conflicts: Array<ConflictRecord & { chapterNo: number }> }
```

### `POST /api/projects/:projectId/run/start`

- 用途：启动自动写作
- 请求体：

```ts
{
  fromChapter?: number;
}
```

- 响应：

```ts
RunProgressView
```

- 常见错误：`400`
- 前置条件：
  - 已有正式设定
  - 设定已锁定
  - 没有别的活跃写作任务

### `GET /api/projects/:projectId/run/progress`

- 用途：轮询写作进度
- 响应：

```ts
RunProgressView
```

### `POST /api/projects/:projectId/run/pause`

- 用途：暂停自动写作
- 响应：

```ts
RunProgressView
```

### `POST /api/projects/:projectId/run/resume`

- 用途：恢复自动写作
- 响应：

```ts
RunProgressView
```

- 说明：
  - 如果当前进程内任务还活着，会原位恢复
  - 如果只是留下暂停状态但没有活进程，会从 `currentChapter` 冷启动

### `POST /api/projects/:projectId/run/stop`

- 用途：停止自动写作
- 响应：

```ts
RunProgressView
```

## 3.10 文件与演示接口

### `GET /api/files/read`

- 用途：读取项目目录内可读文件片段
- 仅允许读取 `projects/<projectId>/` 内的文件；`config/`、`prompts/`、`styles/` 不可达
- Query：

```ts
{
  projectId?: string;     // 推荐：与 relativePath 搭配使用
  relativePath?: string;  // 项目内相对路径
  path?: string;          // 旧参数：projects/<projectId>/... 或 projects 目录内绝对路径
  start?: number; // 默认 0，字符偏移
  end?: number;   // 字符偏移，且必须大于 start
}
```

- 响应：

```ts
{
  content: string;
  start: number;
  end: number;
  size: number;
  path: string; // 项目内相对路径
}
```

### `GET /api/demo`

- 用途：演示/假数据接口，不建议真实 UI 依赖
- Query：

```ts
{
  endpoint?: "projects" | "chapters" | "profiles" | "project-detail" | "api-docs";
  id?: string;
  projectId?: string;
}
```

- 响应：根据 `endpoint` 返回 mock 数据
- 注意：
  - `endpoint=api-docs` 返回的是 demo mock 清单，不是当前真实契约
  - 其中包含若干过期路径和过期方法，仅用于演示

### `POST /api/demo`

- 用途：演示用创建项目
- Query：

```ts
{
  endpoint: "create-project";
}
```

- 请求体：松散 mock body
- 响应：

```ts
{ project: Record<string, unknown> }
```

- 备注：当前代码里 `POST /api/demo` 只识别 query `endpoint=create-project`，其他值会返回：

```ts
{ error: "Unknown endpoint" }
```

## 4. Stitch 重做 UI 时的建议映射

### 4.1 项目列表页

- 直接用 `GET /api/projects`
- 回收站单独用 `GET /api/projects/trash`

### 4.2 项目详情页

- 用 `GET /api/projects/:projectId` 作为主数据源
- 章节导航不要等单独章节列表接口
  - 推荐合并这些字段：
    - `writtenChapters`
    - `blueprints`
    - `reviewStates`
    - `invalidatedHistory`
    - `runState.currentChapter`

### 4.3 写作运行面板

- 轮询 `GET /api/projects/:projectId/run/progress`
- `stage = manual_review` 时，进入人工处理 UI
- `stage = interrupted` 表示心跳超时，不是正常暂停

### 4.4 设定工作台

- 首屏拉 `GET /foundation/workshop`
- 普通聊天用 `POST /foundation/workshop`
- 如果要边生成边显示打字效果，用 `stream=1`

### 4.5 文风系统

- 搜索候选：`GET /foundation/style-search?query=...`
- 上传参考：`POST /foundation/style-imports`
- 生成 snapshot：`POST /foundation/style-snapshots`
- 应用 snapshot：`POST /foundation/style-snapshots/:snapshotId/apply`
- 人工文风调优：`PUT /foundation/workshop/style-steering`

### 4.6 章节编辑器

- 详情面板：`GET /chapters/:chapterNo`
- 局部优化先拿 patch：`POST /optimize`
- 真正落库再调：`POST /apply-patch`
- 版本切换：`GET /versions` + `POST /rollback`

## 5. 路由覆盖清单

本文件已覆盖当前代码中的全部路由域：

- `platform/src/app/api/settings/**` - 模型配置（5 个路由）
- `platform/src/app/api/ideas/**` - 想法库（6 个路由）
- `platform/src/app/api/authors/**` - 作者卡库（8 个路由）
- `platform/src/app/api/projects/**` - 项目、章节、运行控制（43 个路由）
- `platform/src/app/api/files/**` - 文件读取（1 个路由）
- `platform/src/app/api/demo/**` - 演示接口（1 个路由）

总计：64 个路由文件，约 75 个 HTTP 方法

如果后端继续演进，优先检查以下目录是否新增 `route.ts`：

- `platform/src/app/api/projects/**`
- `platform/src/app/api/ideas/**`
- `platform/src/app/api/settings/**`
- `platform/src/app/api/authors/**`

## 6. 测试与文档

### 6.1 测试覆盖

- 服务端单元测试：约 321 个测试文件
- UI 组件测试：17 个测试文件
- E2E 测试：3 个关键流程
  - 项目创建流程（`e2e/01-project-creation-flow.spec.ts`）
  - 章节写作流程（`e2e/02-chapter-writing-flow.spec.ts`）
  - 版本管理流程（`e2e/03-version-management-flow.spec.ts`）

### 6.2 相关文档

- `SYSTEM_ARCHITECTURE.md` - 系统架构总览
- `DEVELOPER_GUIDE.md` - 开发者指南
- `README.md` - 快速开始

### 6.3 Storybook 文档

核心组件已添加 Storybook 文档：

- `FoundationWorkshopClient` - 设定工作台
- `ProjectDetailClient` - 项目详情页
- `ChapterWorkshopClient` - 章节工作台

运行 `pnpm storybook` 查看交互式文档。
