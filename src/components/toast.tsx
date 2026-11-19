"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Info,
  X,
} from "lucide-react";

/* ── types ──────────────────────────────────────────────── */

type ToastVariant = "success" | "error" | "warning" | "info";

interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
  /** 自动关闭延迟（ms），0 表示永不自动关闭 */
  duration: number;
  exiting?: boolean;
}

interface ToastContextValue {
  toast: (message: string, variant?: ToastVariant, duration?: number) => void;
  /** 手动移除指定 toast */
  dismiss: (id: string) => void;
}

/* ── context ────────────────────────────────────────────── */

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}

/* ── variant configuration ──────────────────────────────── */

const variantIcon: Record<ToastVariant, React.ReactNode> = {
  success: <CheckCircle className="h-4 w-4 shrink-0 text-[var(--success)]" />,
  error: <AlertCircle className="h-4 w-4 shrink-0 text-[var(--danger)]" />,
  warning: <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--warn)]" />,
  info: <Info className="h-4 w-4 shrink-0 text-[var(--azure)]" />,
};

const variantStyle: Record<ToastVariant, string> = {
  success:
    "border-[color-mix(in_srgb,var(--success)_28%,transparent)] bg-[color-mix(in_srgb,var(--success)_10%,var(--panel))]",
  error:
    "border-[color-mix(in_srgb,var(--danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--danger)_10%,var(--panel))]",
  warning:
    "border-[color-mix(in_srgb,var(--warn)_28%,transparent)] bg-[color-mix(in_srgb,var(--warn)_10%,var(--panel))]",
  info: "border-[var(--line-strong)] bg-[var(--panel)]",
};

/** 左侧的彩色竖条 */
const variantBar: Record<ToastVariant, string> = {
  success: "bg-[var(--success)]",
  error: "bg-[var(--danger)]",
  warning: "bg-[var(--warn)]",
  info: "bg-[var(--azure)]",
};

const DEFAULT_DURATION: Record<ToastVariant, number> = {
  success: 3000,
  error: 6000,
  warning: 5000,
  info: 3500,
};

/* ── provider ───────────────────────────────────────────── */

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 280);
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (message: string, variant: ToastVariant = "info", duration?: number) => {
      const id = Math.random().toString(36).slice(2);
      const effectiveDuration = duration ?? DEFAULT_DURATION[variant];
      setToasts((prev) => [...prev, { id, message, variant, duration: effectiveDuration }]);
      if (effectiveDuration > 0) {
        const timer = setTimeout(() => dismiss(id), effectiveDuration);
        timers.current.set(id, timer);
      }
    },
    [dismiss],
  );

  const contextValue = useMemo<ToastContextValue>(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <div
        className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2.5 pointer-events-none"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="alert"
            style={{
              animation: t.exiting
                ? "toast-out 280ms ease forwards"
                : "toast-in 220ms ease forwards",
            }}
            className={`acrylic pointer-events-auto relative flex items-start gap-3 overflow-hidden rounded-2xl border pl-5 pr-4 py-3.5 shadow-[var(--shadow-panel)] max-w-sm ${variantStyle[t.variant]}`}
          >
            {/* 左侧竖条 */}
            <span
              className={`absolute left-0 top-0 h-full w-[3px] ${variantBar[t.variant]}`}
            />

            {/* 图标 */}
            <span className="mt-0.5">{variantIcon[t.variant]}</span>

            {/* 文本 */}
            <p className="flex-1 text-sm font-medium leading-5 text-[var(--ink)]">
              {t.message}
            </p>

            {/* 关闭按钮 */}
            <button
              onClick={() => dismiss(t.id)}
              className="shrink-0 rounded-lg p-0.5 text-[var(--ink-soft)] transition-colors hover:text-[var(--ink)] hover:bg-[var(--hover)]"
              aria-label="关闭"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
