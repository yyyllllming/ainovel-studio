import type { Metadata } from "next";
import { JetBrains_Mono, Noto_Sans_SC, ZCOOL_KuaiLe } from "next/font/google";
import "./globals.css";
import { AppProviders } from "./providers.tsx";
import { AppShell } from "@/components/app-shell";
import { BgDecor } from "@/components/bg-decor";
import { ClickBurst } from "@/components/click-burst";
import { ScrollProgress } from "@/components/scroll-progress";
import { THEME_INIT_SCRIPT, ThemeProvider } from "@/components/theme-provider";

const sans = Noto_Sans_SC({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

/* 标题用站酷快乐体：圆滚滚的手写感，撑起可爱的门面（沿用 --font-serif 变量名） */
const display = ZCOOL_KuaiLe({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "taffy的ai写手喵",
  description: "taffy的小说创作工作台，关注永雏塔菲谢谢喵",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body
        className={`${sans.variable} ${display.variable} ${mono.variable} bg-[var(--surface)] text-[var(--ink)] antialiased`}
      >
        {/* 渲染前设置 data-theme，防止主题闪烁（FOUC）。 */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <BgDecor />
        <ScrollProgress />
        <ClickBurst />
        <ThemeProvider>
          <AppProviders>
            <AppShell>{children}</AppShell>
          </AppProviders>
        </ThemeProvider>
      </body>
    </html>
  );
}
