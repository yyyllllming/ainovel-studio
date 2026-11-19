"use client";

import { useRef, type ElementType } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { SplitText } from "gsap/SplitText";

gsap.registerPlugin(useGSAP, SplitText);

/**
 * 彩虹弹跳标题：SplitText 拆成单字，逐字带随机旋转弹入，
 * 单字套 .bouncy-char 五色轮转（颜色在 globals.css）。
 * 只在明确允许动效时才拆字——reduced-motion（以及 jsdom 测试环境）
 * 下保持原始纯文本，可访问名与断言都不受影响。
 */
export function BouncyTitle({
  text,
  className,
  as: Tag = "h1",
}: {
  text: string;
  className?: string;
  as?: ElementType;
}) {
  const ref = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      if (!ref.current) return;
      if (!window.matchMedia("(prefers-reduced-motion: no-preference)").matches) return;
      const split = SplitText.create(ref.current, {
        type: "chars",
        charsClass: "bouncy-char",
        aria: "auto",
      });
      gsap.from(split.chars, {
        autoAlpha: 0,
        y: 26,
        scale: 0.5,
        rotation: () => gsap.utils.random(-14, 14),
        duration: 0.6,
        ease: "back.out(2.2)",
        stagger: 0.05,
        clearProps: "transform,opacity,visibility",
      });
    },
    { scope: ref },
  );

  return (
    <Tag ref={ref} className={className}>
      {text}
    </Tag>
  );
}
