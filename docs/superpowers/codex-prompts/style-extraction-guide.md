# 风格提取执行一页纸

## 入口文件

先读总计划，再按 Session prompt 执行：

```text
platform/docs/superpowers/plans/2026-04-03-style-extraction-upgrade-plan.md

platform/docs/superpowers/codex-prompts/session-s1-fingerprint-and-sampling.md
platform/docs/superpowers/codex-prompts/session-s2-map-reduce-analysis.md
platform/docs/superpowers/codex-prompts/session-s3-integration-and-convergence.md
```

注入引擎是并行轨，不属于本串行链：

```text
platform/docs/superpowers/plans/2026-04-03-context-injection-engine-plan.md
platform/docs/superpowers/codex-prompts/session-1-injection-engine.md
```

## 执行顺序

唯一正确顺序：

```text
S1 -> S2 -> S3
```

执行规则：

1. 先通读 `2026-04-03-style-extraction-upgrade-plan.md`，确认全局目标和完成标准。
2. 读完 `session-s1-fingerprint-and-sampling.md` 全文，按任务顺序完成 S1，跑完该 Session 要求的验证。
3. 只有在 S1 完成且验证通过后，才能开始 `session-s2-map-reduce-analysis.md`。
4. 只有在 S2 完成且验证通过后，才能开始 `session-s3-integration-and-convergence.md`。
5. 不允许跳步，不允许把 S2/S3 任务前置到 S1，中途也不要把三个 Session 交叉执行。

## 核心红线

- 零词汇依赖：`classifyExcerptTags` 及相关采样判定必须只依赖结构/统计特征，不能依赖中文题材词、情绪词、机制词，也不能引入新的替代词表。
- 删不是替换：现有关键词常量要彻底删除，不是改名、搬家、换一组新常量，也不是保留 fallback 词表。
- 先确定性，后 LLM：S1 先建立全文指纹和去洪荒化采样；S2/S3 只能消费这些结果，不能绕过 S1 直接凭 LLM 猜数值。
- 兼容性按 prompt 执行：prompt 明确要求 optional 的新增字段保持 optional；明确要求 `@deprecated` 保留的旧函数不要删。

## 与注入引擎的关系

- 风格提取线只看这三份 prompt：`session-s1-*`、`session-s2-*`、`session-s3-*`。
- 注入引擎线看它自己的计划和 prompt：`2026-04-03-context-injection-engine-plan.md`、`session-1-injection-engine.md`。
- 两条线可以并行推进，因为主改动面不同：风格提取主要落在 `src/server/style/*`，注入引擎主要落在 `src/server/run/*`、`src/server/services/*`、类型与上下文装配层。
- 但“可并行”只表示两条线互不阻塞，不表示风格提取内部可以并行。风格提取内部仍然必须严格保持 `S1 -> S2 -> S3`。

## 给 Codex 的最短指令

如果你是从零开始接手这条线，只做下面这件事：

```text
先读 style-extraction-upgrade-plan，再按 session-s1 -> session-s2 -> session-s3 严格串行执行；
每个 Session 结束先完成验证，再进入下一个；遇到采样标签相关逻辑时，始终遵守“零词汇依赖、删不是替换”。
```
