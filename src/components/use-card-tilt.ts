"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import type { RefObject } from "react";

gsap.registerPlugin(useGSAP);

/**
 * 卡片 3D 倾斜：指针在 [data-tilt] 卡片上游走时轻微翻转，离开后弹性回正。
 * 只在精细指针（鼠标）且允许动效时启用；触屏与 reduced-motion 无感。
 * 卡片列表随数据/面板切换重建时，把相关状态传进 dependencies 重新绑定。
 */
export function useCardTilt(
  scope: RefObject<HTMLElement | null>,
  dependencies: unknown[] = [],
) {
  useGSAP(
    () => {
      if (!scope.current) return;
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference) and (pointer: fine)", () => {
        const cards = gsap.utils.toArray<HTMLElement>("[data-tilt]", scope.current);
        if (!cards.length) return;

        const cleanups: Array<() => void> = [];
        cards.forEach((card) => {
          gsap.set(card, { transformPerspective: 900 });
          const rotateX = gsap.quickTo(card, "rotationX", { duration: 0.5, ease: "power3.out" });
          const rotateY = gsap.quickTo(card, "rotationY", { duration: 0.5, ease: "power3.out" });

          const onMove = (event: PointerEvent) => {
            const rect = card.getBoundingClientRect();
            const ratioX = (event.clientX - rect.left) / rect.width - 0.5;
            const ratioY = (event.clientY - rect.top) / rect.height - 0.5;
            rotateY(ratioX * 10);
            rotateX(ratioY * -8);
          };
          const onLeave = () => {
            gsap.to(card, {
              rotationX: 0,
              rotationY: 0,
              duration: 0.7,
              ease: "elastic.out(1, 0.55)",
              overwrite: "auto",
            });
          };

          card.addEventListener("pointermove", onMove);
          card.addEventListener("pointerleave", onLeave);
          cleanups.push(() => {
            card.removeEventListener("pointermove", onMove);
            card.removeEventListener("pointerleave", onLeave);
          });
        });

        return () => cleanups.forEach((cleanup) => cleanup());
      });
      return () => mm.revert();
    },
    { scope, dependencies, revertOnUpdate: true },
  );
}
