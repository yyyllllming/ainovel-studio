"use client";

import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
} from "react";
import { Monitor, MoonStar, Sun } from "lucide-react";

export type ThemePreference = "milk" | "night" | "auto";
export type ResolvedTheme = "milk" | "night";

const STORAGE_KEY = "taffy-theme";
const DEFAULT_PREFERENCE: ThemePreference = "night";

/** layout.tsx 里内联到 <body> 顶部的首屏脚本：渲染前设好 data-theme，防止主题闪烁。 */
export const THEME_INIT_SCRIPT = `(function(){var d=document.documentElement;try{var t=localStorage.getItem("${STORAGE_KEY}");if(t!=="milk"&&t!=="night"&&t!=="auto")t="${DEFAULT_PREFERENCE}";var r=t==="auto"?(window.matchMedia("(prefers-color-scheme: dark)").matches?"night":"milk"):t;d.dataset.theme=r;}catch(e){d.dataset.theme="${DEFAULT_PREFERENCE}";}})();`;

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "milk" || value === "night" || value === "auto";
}

/* ── 偏好存储：localStorage 外部 store，经 useSyncExternalStore 接入 ── */

let cachedPreference: ThemePreference | null = null;
const listeners = new Set<() => void>();

function readStoredPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isThemePreference(stored)) return stored;
  } catch {
    /* localStorage 不可用时走默认值 */
  }
  return DEFAULT_PREFERENCE;
}

function getPreferenceSnapshot(): ThemePreference {
  if (cachedPreference === null) {
    cachedPreference = readStoredPreference();
  }
  return cachedPreference;
}

function getServerPreferenceSnapshot(): ThemePreference {
  return DEFAULT_PREFERENCE;
}

function subscribePreference(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setStoredPreference(next: ThemePreference) {
  cachedPreference = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* 忽略写入失败 */
  }
  listeners.forEach((listener) => listener());
}

/* ── 应用主题：支持从切换按钮涌出的圆形扩散过渡 ── */

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { ready: Promise<void> };
};

let pendingOrigin: { x: number; y: number } | null = null;

/** ThemeToggle 点击时记录坐标，让扩散圆从按钮位置涌出。 */
function setThemeTransitionOrigin(origin: { x: number; y: number }) {
  pendingOrigin = origin;
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "night"
    : "milk";
}

function applyTheme(resolved: ResolvedTheme) {
  const root = document.documentElement;
  if (root.dataset.theme === resolved) {
    pendingOrigin = null;
    return;
  }

  const doc = document as ViewTransitionDocument;
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  /* 只有用户点击切换（带坐标）才走 View Transition：
     初始水合、系统主题联动一律同步切换，避免异步回调迟到覆盖新值。 */
  if (!pendingOrigin || !doc.startViewTransition || reduceMotion) {
    pendingOrigin = null;
    root.classList.add("theme-switching");
    root.dataset.theme = resolved;
    window.setTimeout(() => root.classList.remove("theme-switching"), 120);
    return;
  }

  const origin = pendingOrigin;
  pendingOrigin = null;
  const transition = doc.startViewTransition(() => {
    root.dataset.theme = resolved;
  });
  transition.ready
    .then(() => {
      const radius = Math.hypot(
        Math.max(origin.x, window.innerWidth - origin.x),
        Math.max(origin.y, window.innerHeight - origin.y),
      );
      root.animate(
        {
          clipPath: [
            `circle(0px at ${origin.x}px ${origin.y}px)`,
            `circle(${radius}px at ${origin.x}px ${origin.y}px)`,
          ],
        },
        {
          duration: 620,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          pseudoElement: "::view-transition-new(root)",
        },
      );
    })
    .catch(() => {
      /* 过渡被跳过或中断时静默降级为瞬切 */
    });
}

interface ThemeContextValue {
  preference: ThemePreference;
  setPreference: (next: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const preference = useSyncExternalStore(
    subscribePreference,
    getPreferenceSnapshot,
    getServerPreferenceSnapshot,
  );

  useEffect(() => {
    /* 直接读客户端存储：水合首帧的 preference 是服务端默认值，
       以它驱动会把存储主题错误地切回默认。 */
    const stored = getPreferenceSnapshot();
    applyTheme(stored === "auto" ? systemTheme() : stored);
    if (stored !== "auto") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme(media.matches ? "night" : "milk");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preference]);

  return (
    <ThemeContext.Provider
      value={{ preference, setPreference: setStoredPreference }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme 必须在 ThemeProvider 内使用");
  }
  return context;
}

/* ── 顶栏切换按钮 ── */

const CYCLE: ThemePreference[] = ["milk", "night", "auto"];

const PREFERENCE_META: Record<
  ThemePreference,
  { label: string; icon: typeof Sun }
> = {
  milk: { label: "奶昔日间", icon: Sun },
  night: { label: "夜猫模式", icon: MoonStar },
  auto: { label: "跟随系统", icon: Monitor },
};

export function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  const meta = PREFERENCE_META[preference];
  const Icon = meta.icon;

  const cycle = (event: React.MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setThemeTransitionOrigin({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
    const index = CYCLE.indexOf(preference);
    setPreference(CYCLE[(index + 1) % CYCLE.length]);
  };

  return (
    <button
      type="button"
      onClick={cycle}
      className="nav-item"
      title={`主题：${meta.label}（点击切换）`}
      aria-label={`当前主题：${meta.label}，点击切换`}
    >
      {/* key 让图标在偏好切换时重挂载，播一次转体登场 */}
      <Icon key={preference} className="anim-spin-in h-4 w-4 shrink-0" />
      <span className="hidden xl:inline">{meta.label}</span>
    </button>
  );
}
