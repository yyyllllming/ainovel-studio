# taffy的ai写手喵 前端设计规范（甜系粉）

> 2026-07 起生效。旧的"水墨双主题"规范已废弃（其 token 语义与架构被保留复用）。
> 品牌：taffy的ai写手喵 · 灵感来自永雏塔菲（粉色王牌🍀）。

## 设计理念

**塔菲甜系 × 亚克力**：奶昔粉底、糖果渐变、磨砂玻璃面板、圆滚滚的一切、句尾带喵。

| 原则 | 落地 |
|------|------|
| 粉色王牌 | `--accent` 塔菲粉贯穿主操作/激活态，按钮用 `--candy-a/b/c` 三色流动渐变 + 掠光 |
| 马卡龙撞色 | `--tint-*` 五色（粉/紫/蓝/绿/橙）按序轮换：卡片描边与顶带、彩虹标题字、统计数字、点击粒子 |
| 冰感亚克力 | 面板低透明度填充（奶昔 0.45 / 夜猫 0.42）+ `backdrop-filter: blur(22px) saturate(1.5)` + 玻璃边高光（`inset 0 1px 0 var(--glass-edge)`）+ 冰面反光 `--glass-sheen`（左上白霜斜向消融）；边框立骨架，内里透到背景色 |
| 圆滚滚 | 面板 20px 圆角、按钮/胶囊全圆、贴纸卡虚线描边 |
| 果冻弹性 | 按钮 hover/active 用 `cubic-bezier(.34,1.56,.64,1)` 弹簧过渡，入场动效 back.out |
| 糖果云 | 背景四团柔光色斑（粉/薰衣草/薄荷/天蓝）漂浮 + 滚动视差，七颗小星星错峰闪烁 |
| 喵化文案 | 关键空态/加载/说明句尾带"喵"，自称 taffy；克制使用（每页 2-3 处） |

---

## 主题系统

双主题，通过 `html[data-theme]` 切换：

- **`milk` 奶昔日间（默认）**：奶昔粉底 `#fff4f8`、可可文字 `#4b3a45`
- **`night` 夜猫模式**：深莓紫底 `#241a2f`、粉白文字 `#f4e6ee`、发光粉主色

### 切换机制

- 首屏：`layout.tsx` 内联脚本（`THEME_INIT_SCRIPT`）渲染前读 `localStorage("taffy-theme")` 设置 `data-theme`，无 FOUC
- 运行时：`ThemeProvider`（`src/components/theme-provider.tsx`，`useSyncExternalStore`，零依赖）
- **圆形扩散过渡**：点击 `ThemeToggle` 时用 View Transitions API + WAAPI 驱动 `clip-path circle()` 从按钮位置涌出（620ms）；不支持或 `prefers-reduced-motion` 时回退瞬切
- ⚠️ 只有用户点击（记录了坐标）才走 View Transition；初始水合、系统主题联动必须**同步**切换——异步回调会迟到覆盖新值（已踩过：水合首帧用服务端默认值跑 startViewTransition，把存储主题吃掉）
- ⚠️ ThemeProvider 的 effect 直接读 `getPreferenceSnapshot()`（客户端存储），不要用水合期的 React 状态驱动 applyTheme
- 入口：顶栏 `ThemeToggle`，三态循环 奶昔日间 → 夜猫模式 → 跟随系统
- 预览页：`/theme-preview`（双主题组件矩阵并排）

### 颜色使用铁律

1. **组件里禁止裸写 `rgba(...)` / hex 颜色**，一律使用 token 或 `color-mix(in srgb, var(--token) N%, transparent)`
2. Tailwind 任意值写法：`bg-[var(--panel)]`、`border-[color-mix(in_srgb,var(--danger)_30%,transparent)]`（下划线代空格）
3. 按钮上的白字用 `--accent-ink`（夜猫下是深莓色深字），不写 `text-white`
4. 阴影用 `--shadow-panel` / `--shadow-soft`（奶昔下自带粉色光晕）

---

## 色彩令牌（globals.css）

token 名沿用水墨版语义（`--ink` 系 = 文字层级），组件无需感知换肤。

### 面

| Token | 语义 |
|-------|------|
| `--surface` / `--surface-deep` | 页面底 / 深层底（body 渐变用） |
| `--panel` / `--panel-muted` / `--panel-soft` | 亚克力面板（**半透明**）/ 弱化面板 / 极淡面板 |
| `--panel-solid` | 实心面板：不支持 backdrop-filter 的 `@supports` 降级底 |
| `--field` | 输入框底（半透明，坐在玻璃面板上无需自带 blur） |
| `--glass-edge` | 玻璃上边缘高光（inset 1px 白线，夜猫下极淡） |
| `--glass-sheen` | 冰面反光渐变（背景第一层：`background: var(--glass-sheen), var(--panel)`） |
| `--sidebar` | 顶栏（半透明 + backdrop-blur） |
| `--reading-paper` | 全屏阅读模式纸面（**保持不透明**，长文阅读不上玻璃） |

亚克力规则：真正的 `backdrop-filter` 只加在**顶层大面**（`.workspace-panel`/`.card`/`.scroll-container`/`.workspace-sidebar`/`.app-sidebar`）和悬浮层（吐司、弹窗加 `.acrylic` 类）；面板内部的条目/胶囊/输入框只用半透明底色，不再嵌套 blur。

### 文字层级

| Token | 甜系名 | 用途 |
|-------|--------|------|
| `--ink` | 可可 | 标题、正文 |
| `--ink-soft` | 奶咖 | 次要文字 |
| `--ink-faint` | 浅莓 | 辅助、占位、section-title |
| `--reading-ink` / `--reading-ink-soft` | — | 阅读模式专用 |

### 强调与状态

| Token | 甜系色 | 用途 |
|-------|--------|------|
| `--accent` / `--accent-hover` / `--accent-soft` / `--accent-ink` | 塔菲粉 | 主操作、激活态、贴纸 |
| `--candy-a` / `--candy-b` / `--candy-c` | 糖果渐变 | 主按钮/激活导航三色流动渐变（c 为薰衣草紫） |
| `--tint-pink/violet/sky/mint/peach` | 马卡龙五色 | 撞色卡、彩虹标题、统计数字、点击粒子；经 `[data-tone]` 映射到 `--tone` |
| `--accent-glow` | 粉光晕 | 主按钮阴影 |
| `--azure` | 长春花蓝 | 信息、次强调、焦点环 |
| `--success` | 四叶草绿🍀 | 成功（塔菲的幸运草） |
| `--warn` | 蜜桃橙 | 警告 |
| `--danger` | 草莓红 | 危险 |
| `--status-*-bg/fg` | — | StatusBadge 七类状态（idle/blueprint/writing/review/alert/done/warn） |

### 线与杂项

`--line` / `--line-strong`（粉调边框）、`--hover`（悬停粉洗）、`--wash-a/b/c`（页面糖果晕）、`--blob-a/b/c` + `--blob-opacity`（漂浮色斑）、`--shadow-panel` / `--shadow-soft`。

---

## 字体

- 标题：站酷快乐体 ZCOOL KuaiLe（变量名沿用 `--font-serif`，勿改名，全站标题都引用它）
- 正文：Noto Sans SC（`--font-sans`）
- 数据/时间戳：JetBrains Mono（`--font-mono`）
- 站酷快乐体只有 400 字重，粗体由浏览器合成，可接受

---

## 组件类（globals.css 提供）

| 类 | 说明 |
|----|------|
| `.workspace-panel` / `.card` | 主面板：panel 底、粉线边框、20px 圆角、粉晕阴影 |
| `.workspace-item`（`+ .active`） | 列表条目：14px 圆角、hover 粉洗 |
| `.workspace-pill` | 胶囊标签 |
| `.btn-primary` | **糖果渐变**：candy-a→b 渐变 + 粉光晕 + 果冻弹性（hover 上浮放大 / active 按扁） |
| `.btn-secondary` | 纸底描边，hover 粉边 + 微弹 |
| `.btn-ghost` | 幽灵按钮，全圆角 |
| `.form-input` / `.form-label` | 输入：粉底内凹，焦点长春花环 |
| `.nav-item`（`+ .active`） | 顶栏导航：激活态 = 粉浅底 + 粉字，hover 上浮 1px |
| `.seal` / `.seal-h` | 贴纸标签（沿用旧印章类名）：粉描边小签 |
| `.scroll-container` | 贴纸卡：2px 虚线粉描边（项目卡、手账风容器） |
| `.tone-card` + `data-tone="pink…"` | 撞色卡：顶部色带 + 同色描边，悬停同色光晕；⚠️ 默认 `--tone` 用 `:where()` 写（零特异性），否则会盖掉 `[data-tone]` 映射 |
| `.candy-top` | 大面板头顶五色渐变带（列表页 hero 用） |
| `.gradient-text` | 三色流动渐变字（品牌名、空态标题） |
| `.bouncy-char` | BouncyTitle 拆出的单字：竖向渐变 + 五色轮转 |
| `.candy-chip` | 糖果渐变圆片（logo、空态图标底），常配 `.float-y` 上下漂浮 |
| `.anim-pop-in` | 面板互切（回收站/新建/总览）时的果冻弹入，挂在条件渲染的根上 |
| `.anim-spin-in` | 主题图标切换转体（ThemeToggle 里 `key={preference}` 触发重挂载） |
| `.scroll-progress` | 顶部糖果渐变滚动进度条（`ScrollProgress` 组件驱动 scaleX） |
| `.section-title` | 小节眉题：浅莓 + 大字距 |
| `.bg-decor` | 全屏糖果云 + 小星星（`BgDecor` 组件；由 .blob-wrap 外层做视差、.blob 内层跑 CSS 漂浮，两套 transform 不打架） |
| `.logo-cat` | 顶栏小猫图标，每 7s 自动摆耳朵，hover 立刻摆 |

圆角规范：面板 20px、条目 14px、按钮/输入全胶囊或 16px。

---

## 布局

- 全局壳：`layout.tsx` → 糖果云 + 顶栏（小猫 logo + "taffy的ai写手喵"）+ `app-main`
- 页面容器：`max-w-[1500px]` 左右、`px-6 py-8` 起步
- 卡片网格：`md:grid-cols-2 xl:grid-cols-3`，卡内文字用 `line-clamp-2/3` 控高

## 动效（GSAP）

- 库：`gsap` + `@gsap/react`；官方 AI 技能装在 `.claude/skills/gsap-*`（来源 [greensock/gsap-skills](https://github.com/greensock/gsap-skills)），写动效前先看对应 SKILL.md
- **入场**：`usePopReveal(scopeRef)`（`src/components/use-pop-reveal.ts`）
  - `data-reveal`：挂载即弹入（autoAlpha + y18 + scale0.97，back.out(1.6)，整组 0.3s 内错落）
  - `data-reveal-scroll`：滚动进入视口按批弹入（`ScrollTrigger.batch`，`once: true`，start "top 92%"）——用于想法/项目卡片网格
  - 完成后 `clearProps: "all"` 清内联样式
- **彩虹弹跳标题**：`BouncyTitle`（`src/components/bouncy-title.tsx`）用 SplitText 拆单字逐字弹入（随机旋转 + back.out(2.2)），单字五色轮转；只在 `(prefers-reduced-motion: no-preference)` 命中时拆字——jsdom 测试环境 matchMedia 恒 false，标题保持纯文本，`getByRole` 断言不受影响
- **卡片 3D 倾斜**：`useCardTilt(scope, deps)`（`use-card-tilt.ts`）对 `[data-tilt]` 卡片做指针跟随翻转（quickTo rotationX/Y ±8~10°），离开 elastic 回正；仅 `(pointer: fine)` 且允许动效；卡片列表随面板切换重建时把状态传入 deps 重绑
- **点击爆裂**：`ClickBurst`（layout 全局）在点击处撒 5-7 颗爱心/星星粒子；输入框内不触发，reduced-motion 整体关闭
- **滚动进度条**：`ScrollProgress` rAF 节流驱动 `.scroll-progress` scaleX，页面不可滚时隐藏
- **糖果云视差**：`BgDecor` 里 ScrollTrigger scrub 只动 `.blob-wrap` 外层（内层 CSS 漂浮动画在 `.blob` 上，避免两套 transform 冲突）
- **页面转场**：`src/app/template.tsx` 每次路由切换整页轻浮入（0.42s back.out(1.2) 微过冲）
- **面板切换**：回收站/新建/总览互切用 `.anim-pop-in`（条件渲染重挂载触发 CSS 动画，无需 JS）
- **主题切换**：View Transitions 圆形扩散（见主题系统），CSS 里已关掉默认交叉淡化（`::view-transition-*(root) { animation: none }`）；ThemeToggle 图标 `key={preference}` 转体登场
- 规则（来自 gsap-react/scrolltrigger/performance skill）：组件内必须 `useGSAP` + `scope`；只动 transform/opacity；ScrollTrigger 走 batch 且 useGSAP 自动清理；`prefers-reduced-motion` 时全部直接呈现终态（hook 内置 `gsap.matchMedia()`）
- 风格约束：甜系可以弹——back.out 弹性、按钮果冻感都欢迎；但时长仍 ≤0.6s，不做长动画阻塞操作

## 可访问性

- 正文/次要文字对比度按 AA 选值；`--ink-faint` 仅用于辅助信息
- 糖果渐变按钮为品牌视觉优先（白字对比约 3-4:1），依赖 700 字重保可读
- `*:focus-visible` 长春花 outline
- 主题切换按钮带 `aria-label`；糖果云 `aria-hidden` 且 reduced-motion 静止

## 测试与回归

- 改动全局样式后跑：`pnpm lint && pnpm typecheck && pnpm test:ui`
- 双主题走查入口：`/theme-preview`
- 断言：`src/**/*.tsx` 中不得出现裸 `rgba(`、hex 色值
- Turbopack 坑：新建文件里的 Tailwind 类不生效时，删 `.next/dev` 再起服务器
