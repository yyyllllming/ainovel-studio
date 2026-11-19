"use client";

import { useEffect, useRef } from "react";

/** 顶部糖果渐变滚动进度条；页面不可滚动时保持隐藏（scaleX 0）。 */
export function ScrollProgress() {
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let frame = 0;

    const update = () => {
      frame = 0;
      const node = bar.current;
      if (!node) return;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (max <= 24) {
        node.style.transform = "scaleX(0)";
        return;
      }
      const ratio = Math.min(1, Math.max(0, window.scrollY / max));
      node.style.transform = `scaleX(${ratio})`;
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return <div ref={bar} aria-hidden className="scroll-progress" />;
}
