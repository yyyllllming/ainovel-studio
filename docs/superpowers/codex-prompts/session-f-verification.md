# Codex Prompt — Session F: 全链路验证

## 上下文

AINovel Studio（`platform/`）刚完成 5 轮健壮性加固：
- Session A: safeParseJson 全量替换
- Session B: DB/文件系统写一致性
- Session C: chapter-runner.ts 拆分
- Session D: 废弃 legacy-bootstrap.ts
- Session E: 前端大组件拆分

需要做一次全量回归验证，确保所有改动没有引入 regression。

## 任务

### 1. 全量自动化验证

```bash
cd platform
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

全部必须通过。如果有失败，分析原因并修复。

### 2. 代码健康度检查

```bash
# JSON.parse 审计：服务端只应剩 llm.ts 中已有防护的调用
grep -rn "JSON.parse" src/server/ --include="*.ts" | grep -v ".test.ts" | grep -v "llm.ts" | grep -v "safe-json.ts"
# 预期输出为空

# legacy-bootstrap 已删除
test ! -f src/server/db/legacy-bootstrap.ts && echo "OK: legacy-bootstrap deleted"

# chapter-runner 行数
wc -l src/server/run/chapter-runner.ts
# 预期 ≤ 950

# 前端组件行数
wc -l src/components/foundation-workshop-client.tsx src/components/idea-detail-client.tsx src/components/project-detail-client.tsx
# 预期各 ≤ 300

# 无循环依赖：新 run/ 模块不 import chapter-runner
grep -rn "from.*chapter-runner" src/server/run/chapter-draft.ts src/server/run/chapter-style-pass.ts src/server/run/chapter-audit.ts src/server/run/chapter-review.ts src/server/run/chapter-finalize.ts 2>/dev/null
# 预期输出为空
```

### 3. 如果有验证失败

- 分析根因
- 修复问题
- 重新运行全量验证
- 在输出中说明发现了什么问题以及如何修复的

## 验证标准

- [ ] pnpm lint — 无错误
- [ ] pnpm typecheck — 无类型错误
- [ ] pnpm test — 359+ 测试全通过
- [ ] pnpm build — Next.js + runner worker 构建成功
- [ ] JSON.parse 审计通过
- [ ] legacy-bootstrap.ts 已删除
- [ ] chapter-runner.ts ≤ 950 行
- [ ] 前端主组件各 ≤ 300 行
- [ ] 无循环依赖
