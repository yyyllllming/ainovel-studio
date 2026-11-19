# Phase 0 重构任务卡

按优先级排序，每张卡可独立交给 Codex/Claude Code 执行。

## 执行顺序

1. [TASK-001](TASK-001-redact-apikey.md) — 修复 llm-profiles 明文 apiKey 泄漏 (P0 安全)
2. [TASK-002](TASK-002-harden-file-read.md) — 收紧 /api/files/read 读取边界 (P0 安全)
3. [TASK-003](TASK-003-api-contract-tests.md) — 建立 API 契约快照测试 (P0 基础设施)
4. [TASK-004](TASK-004-security-middleware.md) — 加 Origin 校验 + CSRF 防护 (P0 安全)
5. [TASK-005](TASK-005-import-boundary-lint.md) — 建立 route 层 import 禁令 (P0 边界)
6. [TASK-006](TASK-006-extract-run-manager-public-api.md) — 从 run-manager 抽走 route 直调的 5 个用例 (P1 边界)
7. [TASK-007](TASK-007-route-to-service-cards-canon.md) — cards/canon route 改走 service (P1 边界)
8. [TASK-008](TASK-008-split-foundation-workshop.md) — 拆分 foundation-workshop 双职责 (P1 边界)
9. [TASK-009](TASK-009-deprecate-repository-barrel.md) — 废弃 repository.ts mega barrel (P1 边界)

## 约束

- 每张卡完成后必须所有现有测试通过
- 不改 API 响应结构（TASK-001 的 apiKey 除外，那是必要破坏）
- 不做目录大挪移，只做依赖方向修正
- 前端正在重做中，后端改动不能破坏前端正在消费的接口
