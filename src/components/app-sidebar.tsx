"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FolderOpen, Lightbulb, PenTool, Settings2 } from "lucide-react";
import { TaffyMark } from "./taffy-mark";
import clsx from "clsx";
import { ThemeToggle } from "./theme-provider";
import { AuthStatus } from "./auth-status";

const navItems = [
  { href: "/", icon: Lightbulb, label: "想法库" },
  { href: "/projects", icon: FolderOpen, label: "项目库" },
  { href: "/authors", icon: PenTool, label: "作者卡" },
  { href: "/settings", icon: Settings2, label: "模型配置" },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <aside className="app-sidebar">
      <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 py-3">
        <Link href="/" className="logo-link flex items-center gap-2.5">
          <span className="taffy-chip flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full">
            <TaffyMark className="h-9 w-9" size={36} />
          </span>
          <span className="flex items-baseline gap-2.5">
            <span className="gradient-text text-xl font-semibold tracking-[0.04em] [font-family:var(--font-serif)] md:text-2xl">
              taffy的ai写手喵
            </span>
            <span className="hidden text-[10px] tracking-[0.2em] text-[var(--ink-faint)] md:inline">
              关注永雏塔菲谢谢喵
            </span>
          </span>
        </Link>

        <div className="flex flex-wrap items-center gap-1.5 md:gap-2">
          <nav className="flex flex-wrap items-center gap-1.5 md:gap-2">
            {navItems.map(({ href, icon: Icon, label }) => {
              const active =
                href === "/"
                  ? pathname === "/" || pathname.startsWith("/ideas")
                  : pathname.startsWith(href);

              return (
                <Link
                  key={href}
                  href={href}
                  className={clsx("nav-item", active && "active")}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{label}</span>
                </Link>
              );
            })}
          </nav>
          <span aria-hidden className="mx-1 h-4 w-px bg-[var(--line-strong)]" />
          <AuthStatus />
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}
