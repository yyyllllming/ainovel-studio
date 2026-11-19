# TASK-007: cards/canon route 改走 service

## 优先级：P1 边界

## 前置依赖：TASK-005

## 目标
消除 cards 和 canon 相关 route 对 `@/server/repository` 和 `@/server/project-files` 的直接依赖。

## 涉及文件

| 文件 | 操作 |
|---|---|
| `platform/src/server/application/cards.service.ts` | 新建 |
| `platform/src/server/application/canon.service.ts` | 新建 |
| 7 个 route 文件 | 改 import 来源 |

## 当前违规 route 清单

| route | 当前 import | 改为 |
|---|---|---|
| `cards/route.ts` | `@/server/repository`（createCard, ensureCardsFromFoundation, listCards） | `@/server/application/cards.service` |
| `cards/[cardId]/route.ts` | `@/server/repository`（deleteCard, getCard, updateCardDraft, listCardMessages） | `@/server/application/cards.service` |
| `cards/[cardId]/confirm/route.ts` | `@/server/repository`（confirmCard, getCard, unconfirmCard） | `@/server/application/cards.service` |
| `cards/[cardId]/progressions/route.ts` | `@/server/repository`（getCard, listCardProgressions） | `@/server/application/cards.service` |
| `cards/[cardId]/workshop/route.ts` | `@/server/card-workshop`（sendCardWorkshopMessage） | 可保留（card-workshop 不是 repository barrel） |
| `canon/conflicts/route.ts` | `@/server/repository`（listConflicts） | `@/server/application/canon.service` |
| `canon/facts/route.ts` | `@/server/project-files`（readCanonFacts） | `@/server/application/canon.service` |

## 具体操作

### 1. 新建 `platform/src/server/application/cards.service.ts`

```typescript
import "../server-only.ts";

// 从 repository 导入具体函数（不走 barrel）
import {
  createCard as createCardRecord,
  listCards as listCardsRecords,
  getCard as getCardRecord,
  deleteCard as deleteCardRecord,
  updateCardDraft as updateCardDraftRecord,
  listCardMessages as listCardMessagesRecords,
  confirmCard as confirmCardRecord,
  unconfirmCard as unconfirmCardRecord,
  listCardProgressions as listCardProgressionsRecords,
  ensureCardsFromFoundation as ensureCardsFromFoundationRecords,
} from "../repositories/card.repository.ts";

// Re-export 为 service 级 API
export const listCards = listCardsRecords;
export const getCard = getCardRecord;
export const createCard = createCardRecord;
export const deleteCard = deleteCardRecord;
export const updateCardDraft = updateCardDraftRecord;
export const listCardMessages = listCardMessagesRecords;
export const confirmCard = confirmCardRecord;
export const unconfirmCard = unconfirmCardRecord;
export const listCardProgressions = listCardProgressionsRecords;
export const ensureCardsFromFoundation = ensureCardsFromFoundationRecords;
```

注意：初期是薄包装，后续可以加业务逻辑。关键是**切断 route 对 barrel 的依赖**。

### 2. 新建 `platform/src/server/application/canon.service.ts`

```typescript
import "../server-only.ts";
import { listConflicts as listConflictsRecord } from "../repositories/..."; // 找到实际来源
import { readCanonFacts as readCanonFactsFromFiles } from "../project-files.ts";

export const listConflicts = listConflictsRecord;
export const readCanonFacts = readCanonFactsFromFiles;
```

### 3. 修改 6 个 route 文件

每个文件只改 import 来源，函数调用不变。

## 验证方式

```bash
# 1. 所有现有测试通过
cd platform && npx vitest run

# 2. import 检查不再报这些 route 的 repository/project-files 违规
pnpm lint:routes

# 3. 手动验证卡片功能
curl http://localhost:3000/api/projects/{testProjectId}/cards
curl http://localhost:3000/api/projects/{testProjectId}/canon/facts
curl http://localhost:3000/api/projects/{testProjectId}/canon/conflicts
```

## 完成标准

- 6 个 route 不再 import `@/server/repository` 或 `@/server/project-files`
- cards.service.ts 和 canon.service.ts 存在且可用
- 功能不变，API 响应不变
- lint:routes 对这些文件不再报错
