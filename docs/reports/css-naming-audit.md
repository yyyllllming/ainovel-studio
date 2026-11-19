# AINovel Studio - CSS 类命名审查报告

## 审查日期
2026-04-12

## 审查范围
`/d/ainote/ainovel-cli/platform/src/app/globals.css`

---

## 一、发现的命名冲突风险

### 1. 高风险类名（通用名称）

#### `.card`
- **位置**: `globals.css:108`
- **风险等级**: ⚠️ 高
- **问题**: 极其通用的类名，与第三方 UI 库（Bootstrap、Tailwind 插件、Ant Design 等）高度冲突
- **影响范围**: 可能覆盖或被覆盖第三方组件样式
- **建议**: 重命名为 `.ainovel-card`

#### `.btn-primary` / `.btn-secondary` / `.btn-ghost`
- **位置**: `globals.css:224-285`
- **风险等级**: ⚠️ 高
- **问题**: Bootstrap、Bulma、Foundation 等框架的标准按钮类名
- **影响范围**: 如果引入任何 CSS 框架，样式会立即冲突
- **建议**: 重命名为 `.ainovel-btn-primary` / `.ainovel-btn-secondary` / `.ainovel-btn-ghost`

#### `.form-input` / `.form-label`
- **位置**: `globals.css:287-316`
- **风险等级**: ⚠️ 中高
- **问题**: 常见表单类名，与多数 CSS 框架冲突
- **建议**: 重命名为 `.ainovel-form-input` / `.ainovel-form-label`

### 2. 中风险类名（领域通用）

#### `.nav-item` / `.nav-divider`
- **位置**: `globals.css:154-185`
- **风险等级**: ⚠️ 中
- **问题**: Bootstrap 导航组件的标准类名
- **建议**: 重命名为 `.ainovel-nav-item` / `.ainovel-nav-divider`

#### `.workspace-panel` / `.workspace-item` / `.workspace-pill`
- **位置**: `globals.css:109, 194-214`
- **风险等级**: ⚠️ 低中
- **问题**: 虽然不如 `.card` 通用，但在协作工具、IDE 主题中常见
- **建议**: 保持现状或添加前缀 `.ainovel-workspace-*`

### 3. 低风险类名（项目特定）

#### `.seal` / `.seal-h`
- **位置**: `globals.css:339-362`
- **风险等级**: ✅ 低
- **原因**: 项目特定语义，冲突概率极低

#### `.scroll-container` / `.vertical-rl`
- **位置**: `globals.css:324-337`
- **风险等级**: ⚠️ 低中
- **原因**: 功能性类名，可能与工具类库冲突

---

## 二、已实施的改进

### 1. 核心容器类重命名（已完成）
```css
/* 新增带前缀的主类 */
.ainovel-card { ... }
.ainovel-workspace-panel { ... }
.ainovel-card-strong { ... }

/* 保留兼容性别名 */
.card { @apply ainovel-card; }
.workspace-panel { @apply ainovel-workspace-panel; }
.card-strong { @apply ainovel-card-strong; }
```

**优势**:
- 新代码使用 `.ainovel-*` 避免冲突
- 旧代码通过 `@apply` 继续工作
- 渐进式迁移，无破坏性变更

---

## 三、推荐的迁移策略

### 阶段 1: 立即执行（高优先级）
为高风险类名添加前缀别名：

```css
/* 按钮类 */
.ainovel-btn-primary { /* 现有 .btn-primary 样式 */ }
.btn-primary { @apply ainovel-btn-primary; }

.ainovel-btn-secondary { /* 现有 .btn-secondary 样式 */ }
.btn-secondary { @apply ainovel-btn-secondary; }

.ainovel-btn-ghost { /* 现有 .btn-ghost 样式 */ }
.btn-ghost { @apply ainovel-btn-ghost; }

/* 表单类 */
.ainovel-form-input { /* 现有 .form-input 样式 */ }
.form-input { @apply ainovel-form-input; }

.ainovel-form-label { /* 现有 .form-label 样式 */ }
.form-label { @apply ainovel-form-label; }
```

### 阶段 2: 渐进迁移（中优先级）
在新组件中使用 `.ainovel-*` 前缀：

```tsx
// ❌ 旧代码
<button className="btn-primary">提交</button>

// ✅ 新代码
<button className="ainovel-btn-primary">提交</button>
```

### 阶段 3: 全局替换（低优先级）
使用 codemod 或全局搜索替换：

```bash
# 示例：批量替换
find src -name "*.tsx" -exec sed -i 's/className="btn-primary"/className="ainovel-btn-primary"/g' {} +
```

---

## 四、BEM 命名规范建议

对于新增组件，推荐采用 BEM（Block Element Modifier）命名：

```css
/* Block */
.ainovel-dialog { ... }

/* Element */
.ainovel-dialog__header { ... }
.ainovel-dialog__body { ... }
.ainovel-dialog__footer { ... }

/* Modifier */
.ainovel-dialog--danger { ... }
.ainovel-dialog--warning { ... }
```

**优势**:
- 语义清晰，避免嵌套选择器
- 命名空间隔离，零冲突风险
- 易于维护和扩展

---

## 五、Tailwind CSS 集成注意事项

项目已使用 `@import "tailwindcss"`，需注意：

1. **避免与 Tailwind 工具类冲突**
   - Tailwind 的 `.container`、`.btn` 等插件类可能冲突
   - 建议在 `tailwind.config.js` 中禁用不需要的插件

2. **优先使用 Tailwind 工具类**
   - 对于简单样式（padding、margin、颜色），直接用 Tailwind
   - 对于复杂组件样式，使用自定义 `.ainovel-*` 类

3. **使用 `@layer` 组织自定义样式**
   ```css
   @layer components {
     .ainovel-btn-primary { ... }
   }
   ```

---

## 六、总结与行动项

### 当前状态
- ✅ 已为 `.card`、`.workspace-panel`、`.card-strong` 添加前缀
- ⚠️ 仍有 8+ 个高/中风险类名未处理

### 推荐行动
1. **立即**: 为 `.btn-*` 和 `.form-*` 添加前缀别名（30 分钟）
2. **本周**: 在新组件中使用 `.ainovel-*` 前缀（持续）
3. **下月**: 全局替换旧类名（2-4 小时）

### 长期收益
- 零第三方库冲突风险
- 更清晰的代码语义
- 更易于团队协作
- 更好的可维护性

---

## 附录：完整类名清单

### 需要重命名的类（按优先级）
1. **P0 - 高风险**
   - `.card` → `.ainovel-card` ✅
   - `.btn-primary` → `.ainovel-btn-primary`
   - `.btn-secondary` → `.ainovel-btn-secondary`
   - `.btn-ghost` → `.ainovel-btn-ghost`
   - `.form-input` → `.ainovel-form-input`
   - `.form-label` → `.ainovel-form-label`

2. **P1 - 中风险**
   - `.nav-item` → `.ainovel-nav-item`
   - `.nav-divider` → `.ainovel-nav-divider`
   - `.workspace-panel` → `.ainovel-workspace-panel` ✅
   - `.workspace-item` → `.ainovel-workspace-item`
   - `.workspace-pill` → `.ainovel-workspace-pill`

3. **P2 - 低风险**
   - `.scroll-container` → `.ainovel-scroll-container`
   - `.section-title` → `.ainovel-section-title`

### 可保持现状的类
- `.seal` / `.seal-h`（项目特定）
- `.app-shell` / `.app-sidebar` / `.app-main`（应用级前缀）
- `.page-content`（通用但冲突概率低）
