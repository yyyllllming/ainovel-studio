"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { RefObject } from "react";

gsap.registerPlugin(useGSAP, ScrollTrigger);

/**
 * 甜系入场（taffy 风）：
 * - [data-reveal]        挂载即弹入：autoAlpha + 上浮 + 轻微放大，整组果冻感错落
 * - [data-reveal-scroll] 滚动进入视口时按批弹入（ScrollTrigger.batch，once 触发一次）
 * 完成后 clearProps 清掉内联样式，不干扰 hover / CSS 过渡；
 * prefers-reduced-motion 时全部直接呈现终态。
 */
export function usePopReveal(scope: RefObject<HTMLElement | null>) {
  useGSAP(
    (context) => {
      const mounts =
        (context.selector?.("[data-reveal]") as HTMLElement[] | undefined) ??
        [];
      const scrolled =
        (context.selector?.("[data-reveal-scroll]") as
          | HTMLElement[]
          | undefined) ?? [];
      if (!mounts.length && !scrolled.length) return;

      const mm = gsap.matchMedia();
      mm.add(
        {
          motionOk: "(prefers-reduced-motion: no-preference)",
          reduceMotion: "(prefers-reduced-motion: reduce)",
        },
        (mmContext) => {
          const reduceMotion = Boolean(mmContext.conditions?.reduceMotion);

          if (mounts.length) {
            gsap.from(mounts, {
              autoAlpha: 0,
              y: 18,
              scale: 0.97,
              duration: reduceMotion ? 0 : 0.55,
              ease: "back.out(1.6)",
              stagger: reduceMotion ? 0 : { amount: 0.3 },
              clearProps: "all",
            });
          }

          if (scrolled.length) {
            if (reduceMotion) {
              gsap.set(scrolled, { clearProps: "all" });
              return;
            }
            gsap.set(scrolled, { autoAlpha: 0, y: 26, scale: 0.94 });
            ScrollTrigger.batch(scrolled, {
              start: "top 92%",
              once: true,
              onEnter: (batch) =>
                gsap.to(batch, {
                  autoAlpha: 1,
                  y: 0,
                  scale: 1,
                  duration: 0.6,
                  ease: "back.out(1.7)",
                  stagger: 0.08,
                  clearProps: "all",
                }),
            });
          }
        },
      );
      return () => mm.revert();
    },
    { scope },
  );
}
