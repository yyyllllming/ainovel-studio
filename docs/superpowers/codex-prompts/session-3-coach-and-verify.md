# Codex Prompt — Session 3: Foundation Coach 升级 + 全链路验证

## 上下文

AINovel Studio（`platform/`）已完成：
- Session 1: 统一上下文注入引擎（InjectableEntry + assembleInjections）
- Session 2A: Foundation 数据模型升级（CharacterCard/WorldRule 新字段）
- Session 2B: Writer Prompt 瘦身 + Planner Prompt 升级

本 Session 完成最后的收尾：升级 Foundation Coach 引导更丰富的设定，利用蓝图新字段，以及全链路验证。

## 任务

### 1. 升级 foundation-coach.md

**修改文件：** `prompts/foundation-coach.md`

在"优先帮助作者明确"列表（第 3 项）中扩展引导方向：

原文：
```
3. 优先帮助作者明确：核心冲突、主角目标、世界规则、关键关系、故事基调。
```

改为：
```
3. 优先帮助作者明确：核心冲突、主角目标、世界规则（区分核心/场景性规则）、关键关系、故事基调、角色的说话习惯和外貌特征。
```

在 draft 输出的 JSON 格式说明中追加提示（在"额外要求"部分前）：

```
- characterIdeas 中的每个角色，尽可能引导作者描述外貌和说话方式，补充 description 和 speechPattern 字段。
- worldviewIdeas 中的每条规则，引导区分核心规则（故事世界的基础法则）和场景规则（特定场景才相关），设置 priority 字段。
```

### 2. 注入引擎利用蓝图新字段

**修改文件：** `src/server/run/context-entry-collectors.ts`

如果蓝图有 `characterMotivations`，为匹配的角色 InjectableEntry 追加动机信息：

```typescript
export function collectCharacterEntries(
  foundation: FoundationPayload,
  blueprint: ChapterBlueprint,
): InjectableEntry[] {
  return foundation.characters.map(card => {
    // ...现有逻辑...
    
    // 如果蓝图有角色动机，追加到角色卡内容
    const motivation = blueprint.characterMotivations?.find(m => m.name === card.name);
    if (motivation) {
      lines.push(`本章动机：${motivation.motivation}`);
      lines.push(`面临阻碍：${motivation.obstacle}`);
      lines.push(`计划行动：${motivation.action}`);
    }
    
    // ...
  });
}
```

如果蓝图有 `informationControl`，创建 structure-layer 的 InjectableEntry：

```typescript
export function collectBlueprintMetaEntries(blueprint: ChapterBlueprint): InjectableEntry[] {
  const entries: InjectableEntry[] = [];
  
  if (blueprint.informationControl) {
    const ic = blueprint.informationControl;
    const lines: string[] = ["## 信息控制"];
    if (ic.readerKnows?.length) lines.push(`读者已知：${ic.readerKnows.join("；")}`);
    if (ic.reveals?.length) lines.push(`本章揭示：${ic.reveals.join("；")}`);
    const content = lines.join("\n");
    entries.push({
      id: "blueprint:info-control",
      type: "steering",
      content,
      priority: 70,
      tokenCost: estimateModelTokens(content),
      activation: { mode: "always" },
      position: "structure-layer",
    });
  }
  
  if (blueprint.emotionalArc) {
    const content = `情感弧线：${blueprint.emotionalArc}`;
    entries.push({
      id: "blueprint:emotional-arc",
      type: "steering",
      content,
      priority: 65,
      tokenCost: estimateModelTokens(content),
      activation: { mode: "always" },
      position: "structure-layer",
    });
  }
  
  return entries;
}
```

在 `context-engine.ts` 的 `assembleContextPack()` 中调用这个新收集器。

### 3. 全量回归验证

```bash
cd platform
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

### 4. 健康度检查

```bash
# 洪荒正则已全面清除
grep -rn "灵纹\|血脉\|天赋\|反噬\|代价\|追猎\|部族\|禁区\|兽道" src/server/ --include="*.ts" | grep -v ".test.ts" | grep -v "node_modules"
# 预期为空

# pickCharacterCards / pickWorldCards 已删除
grep -rn "pickCharacterCards\|pickWorldCards" src/server/ --include="*.ts"
# 预期为空

# .slice(0, 5) 硬截已删除
grep -rn "slice(0,\s*5)" src/server/run/context-engine.ts
# 预期为空

# writer.md 行数
wc -l prompts/writer.md
# 预期 ≤ 15

# planner.md 行数
wc -l prompts/planner.md
# 预期 ~40

# 注入引擎文件存在
test -f src/server/run/context-injection-engine.ts && echo "OK"
test -f src/server/run/context-entry-collectors.ts && echo "OK"
```

### 5. 如果有验证失败

- 分析根因，修复问题
- 重新运行全量验证
- 在输出中说明发现了什么问题以及如何修复

## 验证标准

- [ ] pnpm lint — 无错误
- [ ] pnpm typecheck — 无类型错误
- [ ] pnpm test — 所有测试通过
- [ ] pnpm build — 构建成功
- [ ] 洪荒硬编码正则已全面清除
- [ ] pickCharacterCards / pickWorldCards 已删除
- [ ] 注入引擎文件存在且有测试
- [ ] writer.md ≤ 15 行
- [ ] planner.md ~40 行
- [ ] CharacterCard 有 description/speechPattern/triggerKeywords 新字段
- [ ] WorldRule 有 priority/triggerKeywords 新字段
- [ ] Relationships 被注入到 Writer prompt
