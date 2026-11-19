import { StatusBadge } from "@/components/status-badge";

export const metadata = {
  title: "主题预览 · taffy的ai写手喵",
};

const SWATCHES: { token: string; name: string }[] = [
  { token: "--surface", name: "奶昔/夜幕 · 页面底" },
  { token: "--panel", name: "面板" },
  { token: "--ink", name: "可可 · 正文" },
  { token: "--ink-soft", name: "奶咖 · 次要" },
  { token: "--ink-faint", name: "浅莓 · 辅助" },
  { token: "--accent", name: "塔菲粉 · 主操作" },
  { token: "--azure", name: "长春花 · 次强调" },
  { token: "--success", name: "四叶草 · 成功" },
  { token: "--warn", name: "蜜桃 · 警告" },
  { token: "--danger", name: "草莓 · 危险" },
];

const BADGE_STATUSES = [
  "idle",
  "blueprint",
  "writing",
  "review",
  "manual_review",
  "completed",
  "ideation",
] as const;

function ThemeColumn({ theme, title, note }: { theme: string; title: string; note: string }) {
  return (
    <section
      data-theme={theme}
      className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)]"
    >
      <div className="border-b border-[var(--line)] bg-[var(--panel)] px-6 py-4">
        <h2 className="text-xl font-semibold tracking-[0.2em] [font-family:var(--font-serif)]">{title}</h2>
        <p className="mt-1 text-xs text-[var(--ink-soft)]">{note}</p>
      </div>

      <div className="grid gap-6 p-6">
        <div>
          <p className="section-title">色板</p>
          <div className="mt-3 grid grid-cols-5 gap-2">
            {SWATCHES.map(({ token, name }) => (
              <div key={token} className="min-w-0">
                <div
                  className="h-12 rounded-lg border border-[var(--line)]"
                  style={{ background: `var(${token})` }}
                />
                <p className="mt-1 truncate text-[10px] leading-4 text-[var(--ink-soft)]" title={`${name} ${token}`}>
                  {name}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="section-title">按钮</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button className="btn-primary">开始写作</button>
            <button className="btn-secondary">次要操作</button>
            <button className="btn-ghost">幽灵操作</button>
            <button className="btn-primary" disabled>
              禁用态
            </button>
          </div>
        </div>

        <div>
          <p className="section-title">表单</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div>
              <label className="form-label">新想法标题</label>
              <input className="form-input" placeholder="例如：会遗失记忆的骗子" />
            </div>
            <div>
              <label className="form-label">节奏</label>
              <select className="form-input" defaultValue="mid">
                <option value="slow">慢节奏</option>
                <option value="mid">中节奏</option>
              </select>
            </div>
          </div>
        </div>

        <div>
          <p className="section-title">状态徽章</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {BADGE_STATUSES.map((status) => (
              <StatusBadge key={status} status={status} />
            ))}
          </div>
        </div>

        <div>
          <p className="section-title">面板与贴纸</p>
          <div className="workspace-panel mt-3 p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="section-title">Project</p>
                <h3 className="mt-2 text-2xl font-semibold [font-family:var(--font-serif)]">山海之上</h3>
                <p className="mt-2 text-sm leading-7 text-[var(--ink-soft)]">
                  姜尘是一只无名小兽，独自在凶地葬骨涧求生，第一次拓取他族天赋时立刻付出惨重代价。
                </p>
              </div>
              <span className="seal-h text-[10px]">系列 01</span>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="workspace-item active px-4 py-3">
                <p className="section-title">结构</p>
                <p className="mt-1 text-sm font-medium">2 卷规划 · 预计 14-28 章</p>
              </div>
              <div className="workspace-item active px-4 py-3">
                <p className="section-title">叙事</p>
                <p className="mt-1 text-sm font-medium">第三人称 · 中节奏</p>
              </div>
            </div>
            <div className="nav-divider mt-4" />
            <div className="mt-3 flex items-center justify-between">
              <span className="workspace-pill px-3 py-1 text-xs text-[var(--ink-soft)]">玄幻志怪</span>
              <span className="text-xs tracking-[0.22em] text-[var(--accent)]">进入工作台</span>
            </div>
          </div>
        </div>

        <div>
          <p className="section-title">文字层级</p>
          <div className="mt-3 grid gap-1.5">
            <p className="text-2xl font-semibold [font-family:var(--font-serif)]">可爱标题 · 站酷快乐体</p>
            <p className="text-sm leading-7">
              重墨正文：先在这里把人物、世界观、主线和开场火花慢慢聊透，再从任意想法一键开项目。
            </p>
            <p className="text-sm text-[var(--ink-soft)]">次要文字：管理单章正文、审核返修、局部修改与本章版本。</p>
            <p className="text-xs text-[var(--ink-faint)]">辅助文字：更新于 2026/7/2 · 仅用于时间戳与占位</p>
            <p className="font-mono text-xs text-[var(--ink-soft)]">mono 2026/07/02 14:00:00 · tokens/s 42</p>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function ThemePreviewPage() {
  return (
    <div className="min-h-screen w-full px-6 py-8">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-6">
        <header>
          <p className="section-title">Theme Preview</p>
          <h1 className="mt-2 text-3xl font-semibold [font-family:var(--font-serif)]">taffy 主题预览喵</h1>
          <p className="mt-2 max-w-2xl text-sm leading-7 text-[var(--ink-soft)]">
            左奶昔右夜猫，并排对照核心组件。顶栏切换按钮可整站切换；此页仅供拍板色值，定稿后可删除。
          </p>
        </header>
        <div className="grid gap-6 xl:grid-cols-2">
          <ThemeColumn theme="milk" title="奶昔日间" note="亮色 · 当前默认主题" />
          <ThemeColumn theme="night" title="夜猫模式" note="暗色 · 深夜码字护眼" />
        </div>
      </div>
    </div>
  );
}
