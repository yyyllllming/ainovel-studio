# 水墨主题重构规划（宣纸 · 夜墨）

> ⚠️ 已废弃（2026-07-02 当日）：视觉方向改为永雏塔菲甜系粉，品牌改名"taffy的ai写手喵"。本次重构的 token 架构、主题切换机制、动效底座被新主题完整继承，仅色值/字体/文案换装。现行规范见 `FRONTEND_DESIGN_SPEC.md`。
> 状态：已实施后被取代（2026-07-02，P0–P3 + 大部分 P4 完成；霞鹜文楷字体与 e2e 截图存档未做）　|　起草：2026-07-02
> 落地记录：token 与双主题在 `src/app/globals.css`；切换机制在 `src/components/theme-provider.tsx` + `layout.tsx`；预览页 `/theme-preview`；组件硬编码颜色已全部清零。
> 目标：用中国传统水墨风格替换现有"暗色金红"主题，并引入完整的主题切换机制（亮/暗双主题）。

---

## 1. 设计方向

### 1.1 核心理念

| 原则 | 含义 | 落到界面上 |
|------|------|-----------|
| **留白** | 水墨画的呼吸感 | 亮色宣纸底、克制的面板层次、减少装饰性渐变 |
| **墨分五色** | 焦、浓、重、淡、清 | 一条 5 阶墨色灰阶贯穿文字/边框/禁用态，代替现在的金色系 |
| **朱砂点睛** | 印章是画面唯一高饱和点 | 朱砂红只用于主操作按钮、印章、关键状态；全站不超过这一处红 |
| **纸墨质感** | 宣纸纹理 + 墨晕 | 极淡的噪点纹理 + 页面边缘淡墨晕染，替换现在的红/金径向光 |

### 1.2 参考对象

- **每日故宫、TAG Design 系列（榫卯 / 折扇）**——传统元素做"点"、现代排版做"面"的典范
- **墨笺**（Material Design × 中国风，见少数派介绍）——水墨配色融入现代组件体系
- **zhongguose.com 中国传统色**——色彩命名与取值来源（UI 落地时按对比度微调）
- 即时设计《国风 UI 界面攻略》——宣纸象牙白 + 朱砂 + 墨色的经典组合

---

## 2. 色彩令牌系统（双主题）

主题标识：`html[data-theme="xuan"]`（宣纸 · 亮）/ `html[data-theme="yemo"]`（夜墨 · 暗）。
色值取名自中国传统色，数值按 UI 对比度调校过，非原值照搬。

### 2.1 基础面

| Token | 语义 | 宣纸（亮） | 夜墨（暗) |
|-------|------|-----------|----------|
| `--surface` | 页面底（纸） | `#f7f2e7` 宣纸 | `#131719` 玄墨 |
| `--surface-deep` | 深层底 | `#efe8d8` 陈纸 | `#0d1012` 焦墨底 |
| `--panel` | 面板/卡片 | `#fcf9f1` | `#1a1f22` |
| `--panel-muted` | 弱化面板 | `#f2ecdf` | `#161b1e` |
| `--sidebar` | 顶栏 | `rgba(252,249,241,0.92)` | `rgba(13,16,18,0.92)` |

### 2.2 墨阶（文字）

| Token | 墨分五色 | 宣纸 | 夜墨 | 对比度(vs surface) |
|-------|---------|------|------|-----|
| `--ink` | 焦墨 · 标题/正文 | `#22282b` | `#e6e0d2`（纸灰） | ≥12:1 |
| `--ink-soft` | 重墨 · 次要文字 | `#565f66` | `#a9a294` | ≥5:1 |
| `--ink-faint` | 淡墨 · 辅助/占位 | `#828c93` | `#6f6f66` | ≥3:1（仅大字号/非关键） |

### 2.3 强调与状态

| Token | 语义 | 宣纸 | 夜墨 |
|-------|------|------|------|
| `--accent` | 朱砂/印泥红（主操作、"朱批"语义） | `#a8402f` | `#c9573f` |
| `--accent-hover` | 悬停 | `#8f3325` | `#d96a52` |
| `--accent-soft` | 朱砂浅底 | `rgba(168,64,47,0.10)` | `rgba(201,87,63,0.16)` |
| `--accent-ink` | 朱砂底上的文字 | `#fdf9ef` | `#fdf9ef` |
| `--azure` | 黛蓝 · 次强调/链接/信息 | `#44586e` | `#8fa3b8` |
| `--success` | 竹青 | `#587a4e` | `#93b989` |
| `--warn` | 赭黄（藤黄调暗） | `#96762a` | `#cfae52` |
| `--danger` | 胭脂 | `#9d2933` | `#d47983` |

### 2.4 线与杂项

| Token | 宣纸 | 夜墨 |
|-------|------|------|
| `--line` | `rgba(34,40,43,0.13)` | `rgba(230,224,210,0.10)` |
| `--line-strong` | `rgba(34,40,43,0.26)` | `rgba(230,224,210,0.22)` |
| `::selection` | 淡墨 `rgba(34,40,43,0.14)` | `rgba(230,224,210,0.18)` |
| 滚动条 | 淡墨 20% → hover 35% | 纸灰 20% → 35% |
| `color-scheme` | `light` | `dark` |

### 2.5 状态徽章（StatusBadge 全部重映射）

现有 7 组 `--status-*-bg/fg` 保留结构，底色统一为对应状态色 8–14% alpha，前景用状态色的主题色阶。金色系（`--gold`、`--gold-bright`）**删除**，引用处按语义改为 `--ink`（标题）或 `--accent`（强调）。

---

## 3. 质感与图形语言

1. **宣纸纹理**：内联 SVG `feTurbulence` 噪点（data-URI，<1.5KB），`body::after` 叠加，宣纸 opacity ≈ 0.025、夜墨 ≈ 0.04。
2. **墨晕**：`body` 背景改为 2–3 个大半径淡墨 `radial-gradient`（替换现在的红/金光晕），宣纸主题晕染更浅。
3. **墨线**：`.nav-divider` 等分隔线保留"两端渐隐"的写法，颜色换淡墨；`.scroll-container` 左右双线由金色改为墨色。
4. **印章**：`.seal` / `.seal-h` 保留并升格为全站视觉锚点，固定朱砂色（两主题不变），系列号、状态钤印用它。
5. **圆角收敛**：面板 28px → 16px，条目 18px → 12px，按钮保留胶囊形——水墨风更接近"册页/界画"的方正儒雅。
6. **阴影**：宣纸主题用淡墨扩散影 `0 8px 24px rgba(34,40,43,0.08)`；夜墨沿用现有深影但减淡。
7. **按钮体系**：primary = 朱砂实底（取"朱批"之意）；secondary = 纸底 + 墨线描边；ghost = 淡墨文字。
8. **进度条纹**（`ainovel-progress-stripe`）：白色高光条纹在亮色下会失效，改用 `currentColor` 低透明度实现。

---

## 4. 字体

- **保留**：Noto Sans SC（正文）、Noto Serif SC（标题衬线）、JetBrains Mono（数据）——已接入 next/font，零额外成本。
- **可选增强（P4 决策）**：霞鹜文楷 GB（开源，Klee One 衍生）用于 H1 与印章/落款装饰文字，不用于正文。
  - 接入方式：npm 子集化包（`@callmebill/lxgw-wenkai-web` 或 `lxgw-wenkai-gb-web`，切片 woff2 按需加载），本地自托管，不走 CDN（符合本项目"本地优先"）。
  - 决策方式：P4 时出"Noto Serif SC vs 霞鹜文楷"标题对比截图，你拍板后再引入依赖。

---

## 5. 主题切换架构

```
html[data-theme="xuan" | "yemo"]
        ▲
        │ ① 首屏：<head> 内联脚本（beforeInteractive）
        │    读 localStorage("ns-theme") → 无值时跟随 prefers-color-scheme
        │    → 渲染前设好 data-theme，杜绝闪烁(FOUC)
        │
        │ ② 运行时：ThemeProvider(React context, ~60 行，零依赖)
        │    暴露 theme / setTheme；写回 localStorage
        │    监听系统主题变化（"auto" 模式时联动）
        │
        └─ ③ 入口：顶栏 nav 右端切换按钮
           三态循环：宣纸 → 夜墨 → 跟随系统（lucide: Sun / Moon / Monitor）
```

要点：
- `layout.tsx` 的 `<html>` 加 `suppressHydrationWarning`（data-theme 由脚本先行写入）。
- 每主题声明 `color-scheme`，原生表单控件/滚动条自动适配。
- 切换瞬间给根元素加 `.theme-switching` 类临时禁用颜色 transition，避免全屏渐变噪声；后续可渐进增强为 View Transitions 淡切。
- 不引入 next-themes（自写 60 行足够；若后续要多主题矩阵再考虑）。

---

## 6. 迁移工作量盘点（grep 实测）

| 项 | 规模 | 说明 |
|----|------|------|
| `globals.css` | 68 处 rgba + 全部 token | **整体重写**（约 480 行 → 550 行，含双主题块） |
| 组件内 `rgba(...)` 字面量 | **101 处 / 26 文件** | 全部替换为 token；重灾区：status-badge 18、manuscript-preview 14、confirm-dialog 8、card-detail-panel 6、card-library 6、toast 5 |
| 组件内 hex 字面量 | 11 处 / 3 文件 | llm-profile-selector、manuscript-preview、author-import-section |
| `var(--gold*)` 引用 | 分散（chapter-workshop 一文件 43 处 var 引用） | 语义化更名，脚本批量替换 + 人工复核 |
| StatusBadge 色板 | 7 状态 × 2 主题 | 按 2.5 节重映射 |
| FRONTEND_DESIGN_SPEC.md | 全文 | 已与实现脱节，按本方案重写 |

**总量估计**：约 30 个文件，净改动 1200–1500 行，拆 4–5 个 commit。

---

## 7. 实施阶段

### P0 · 视觉定稿（先做这个，半天）
建临时路由 `/theme-preview`：左右并排展示宣纸/夜墨色板 + 核心组件矩阵（按钮三态、表单、项目卡、状态徽章、印章、面板嵌套），**你在真实浏览器里看过拍板色值后**再铺开。改色值只动 token 表，成本极低。

### P1 · Token 基建 + 切换机制（半天）
- globals.css 重构为语义 token + 双主题块；先把**现有暗金映射为 `data-theme="legacy"`** 保证零视觉回归
- 内联脚本 + ThemeProvider + 顶栏切换按钮
- 产出：机制可用，界面不变

### P2 · 宣纸主题落地（1–1.5 天，最大块）
- 26 个组件文件的 rgba/hex 清理 → token（按第 6 节清单逐文件勾销）
- 逐页走查：想法库 / 项目库 / 项目工作台 / 章节工作台 / 作者卡 / 设置 / 预览页
- 完工断言：`grep -r "rgba(" src/components` 归零（白名单除外）

### P3 · 夜墨主题（半天）
主要在 token 层调值；组件层若有"亮色专用"写法（阴影、条纹高光）在此抹平。

### P4 · 质感与收尾（半天–1 天）
- 宣纸纹理、墨晕、圆角/阴影统一、印章升格
- 霞鹜文楷对比截图 → 决策是否引入
- 删除 `legacy` 暗金主题（或按你意见保留为第三主题）
- 更新 FRONTEND_DESIGN_SPEC.md
- 回归：lint + typecheck + 71 UI tests + Playwright e2e + 双主题全页截图存档 `docs/reports/`

---

## 8. 风险与对策

| 风险 | 对策 |
|------|------|
| 亮色下淡墨文字对比度不足 | 2.2 节色值已按 WCAG AA 预选；P2 完成时逐组合复核 |
| rgba 清理遗漏导致某主题下"穿帮" | 完工 grep 断言 + 双主题全页截图走查 |
| 切换闪烁（FOUC） | head 内联脚本先于渲染设置 data-theme |
| 暗金→宣纸跨度大，用户（你）可能想保留暗色习惯 | 默认主题建议定为**夜墨**（延续暗色习惯），宣纸一键可切；P0 时一并确认 |
| 纯视觉改动回滚成本 | 每阶段独立 commit，可 git revert 单段 |

---

## 附 · 参考链接

- 中国传统色色值：https://zhongguose.com / https://colors.ichuantong.cn
- 国风 UI 方法论：https://js.design/special/article/national-style-ui-design.html
- 墨笺（Material × 中国风案例）：https://sspai.com/post/35670
- 霞鹜文楷：https://github.com/lxgw/LxgwWenKai （GB 版：lxgw/LxgwWenkaiGB；子集 webfont：chawyehsu/lxgw-wenkai-webfont）
