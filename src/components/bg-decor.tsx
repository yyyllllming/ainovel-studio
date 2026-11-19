"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(useGSAP, ScrollTrigger);

/* 星星的散布位置手工挑过：避开正中的内容热区，四角与留白处各一颗。 */
const SPARKLES = [
  { left: "7%", top: "16%", size: 17, delay: 0, tone: "var(--tint-pink)", glyph: "♡" },
  { left: "21%", top: "74%", size: 13, delay: 1.7, tone: "var(--tint-gold)", glyph: "✦" },
  { left: "44%", top: "9%", size: 12, delay: 2.9, tone: "var(--tint-violet)", glyph: "A" },
  { left: "67%", top: "68%", size: 16, delay: 0.9, tone: "var(--tint-peach)", glyph: "♡" },
  { left: "85%", top: "22%", size: 14, delay: 2.2, tone: "var(--tint-gold)", glyph: "✦" },
  { left: "93%", top: "62%", size: 12, delay: 3.6, tone: "var(--tint-pink)", glyph: "喵" },
  { left: "33%", top: "38%", size: 11, delay: 4.3, tone: "var(--tint-violet)", glyph: "♡" },
] as const;

/** 全屏背景装饰：四团糖果云（带滚动视差）+ 闪烁小星星。 */
export function BgDecor() {
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        /* 视差只动 .blob-wrap 外层，内层 .blob 的 CSS 漂浮动画不受影响 */
        const wraps = gsap.utils.toArray<HTMLElement>(".blob-wrap", scope.current);
        wraps.forEach((wrap, index) => {
          gsap.to(wrap, {
            yPercent: index % 2 === 0 ? -14 : 12,
            ease: "none",
            scrollTrigger: {
              start: 0,
              end: "max",
              scrub: 1.2,
              invalidateOnRefresh: true,
            },
          });
        });
      });
      return () => mm.revert();
    },
    { scope },
  );

  return (
    <div ref={scope} aria-hidden className="bg-decor">
      <span className="blob-wrap"><i className="blob" /></span>
      <span className="blob-wrap"><i className="blob" /></span>
      <span className="blob-wrap"><i className="blob" /></span>
      <span className="blob-wrap"><i className="blob" /></span>
      {SPARKLES.map((sparkle, index) => (
        <i
          key={index}
          className="sparkle"
          style={{
            left: sparkle.left,
            top: sparkle.top,
            fontSize: sparkle.size,
            color: sparkle.tone,
            animationDelay: `${sparkle.delay}s`,
          }}
        >
          {sparkle.glyph}
        </i>
      ))}
    </div>
  );
}
