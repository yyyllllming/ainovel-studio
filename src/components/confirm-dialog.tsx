"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AlertTriangle, Trash2, X } from "lucide-react";

/* ── types ──────────────────────────────────────────────── */

type ConfirmVariant = "danger" | "warning" | "info";

interface ConfirmOptions {
  title: string;
  description: string;
  /** 确认按钮文案，默认 "确认" */
  confirmLabel?: string;
  /** 取消按钮文案，默认 "取消" */
  cancelLabel?: string;
  variant?: ConfirmVariant;
}

interface ConfirmContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

/* ── context ────────────────────────────────────────────── */

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used inside ConfirmDialogProvider");
  return ctx;
}

/* ── variant styles ─────────────────────────────────────── */

const variantConfig: Record<
  ConfirmVariant,
  {
    icon: React.ReactNode;
    iconBg: string;
    confirmBtn: string;
  }
> = {
  danger: {
    icon: <Trash2 className="h-5 w-5 text-[var(--danger)]" />,
    iconBg: "bg-[color-mix(in_srgb,var(--danger)_12%,transparent)]",
    confirmBtn:
      "border-[color-mix(in_srgb,var(--danger)_55%,transparent)] bg-[color-mix(in_srgb,var(--danger)_16%,transparent)] text-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_26%,transparent)]",
  },
  warning: {
    icon: <AlertTriangle className="h-5 w-5 text-[var(--warn)]" />,
    iconBg: "bg-[color-mix(in_srgb,var(--warn)_12%,transparent)]",
    confirmBtn:
      "border-[color-mix(in_srgb,var(--warn)_50%,transparent)] bg-[color-mix(in_srgb,var(--warn)_12%,transparent)] text-[var(--warn)] hover:bg-[color-mix(in_srgb,var(--warn)_22%,transparent)]",
  },
  info: {
    icon: <AlertTriangle className="h-5 w-5 text-[var(--azure)]" />,
    iconBg: "bg-[color-mix(in_srgb,var(--azure)_12%,transparent)]",
    confirmBtn:
      "border-[var(--line-strong)] bg-[var(--panel)] text-[var(--ink)] hover:bg-[var(--panel-muted)]",
  },
};

/* ── provider ───────────────────────────────────────────── */

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

export function ConfirmDialogProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setPending({ ...options, resolve });
    });
  }, []);

  const handleClose = useCallback(
    (result: boolean) => {
      pending?.resolve(result);
      setPending(null);
      requestAnimationFrame(() => previousFocusRef.current?.focus());
    },
    [pending],
  );

  /* Esc 关闭 */
  useEffect(() => {
    if (!pending) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleClose(false);
      if (event.key === "Tab" && dialogRef.current) {
        const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ));
        if (!focusable.length) return;
        const first = focusable[0]!;
        const last = focusable.at(-1)!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pending, handleClose]);

  const variant = pending?.variant ?? "info";
  const cfg = variantConfig[variant];

  const contextValue = useMemo<ConfirmContextValue>(() => ({ confirm }), [confirm]);

  return (
    <ConfirmContext.Provider value={contextValue}>
      {children}

      {pending ? (
        <div
          ref={backdropRef}
          className="fixed inset-0 z-[200] flex items-center justify-center"
          onClick={(event) => {
            if (event.target === backdropRef.current) handleClose(false);
          }}
        >
          {/* backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            style={{ animation: "confirm-backdrop-in 180ms ease forwards" }}
          />

          {/* dialog */}
          <div
            ref={dialogRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            aria-describedby="confirm-desc"
            className="acrylic relative z-10 mx-4 w-full max-w-md rounded-3xl border border-[var(--line)] bg-[var(--panel)] p-6 shadow-[var(--shadow-panel)]"
            style={{ animation: "confirm-dialog-in 220ms ease forwards" }}
          >
            {/* close button */}
            <button
              onClick={() => handleClose(false)}
              className="absolute right-4 top-4 rounded-xl p-1.5 text-[var(--ink-soft)] transition-colors hover:bg-[var(--hover)]"
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </button>

            {/* icon */}
            <div className={`mb-4 inline-flex h-11 w-11 items-center justify-center rounded-2xl ${cfg.iconBg}`}>
              {cfg.icon}
            </div>

            {/* text */}
            <h3
              id="confirm-title"
              className="text-lg font-semibold text-[var(--ink)] [font-family:var(--font-serif)]"
            >
              {pending.title}
            </h3>
            <p
              id="confirm-desc"
              className="mt-2 text-sm leading-6 text-[var(--ink-soft)]"
            >
              {pending.description}
            </p>

            {/* actions */}
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => handleClose(false)}
                className="rounded-full border border-[var(--line)] bg-[var(--panel)] px-5 py-2.5 text-sm font-medium text-[var(--ink-soft)] transition-colors hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
              >
                {pending.cancelLabel ?? "取消"}
              </button>
              <button
                onClick={() => handleClose(true)}
                autoFocus
                className={`rounded-full border px-5 py-2.5 text-sm font-semibold transition-colors ${cfg.confirmBtn}`}
              >
                {pending.confirmLabel ?? "确认"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ConfirmContext.Provider>
  );
}
