"use client";

import { useEffect } from "react";
import gsap from "gsap";

const GLYPHS = ["♡", "♥", "✦", "A", "喵"];
const TONE_VARS = [
  "var(--tint-pink)",
  "var(--tint-gold)",
  "var(--tint-violet)",
  "var(--tint-peach)",
  "var(--accent)",
];

/**
 * 点击爆裂：在点击处撒一小把爱心和星星，飘散后自动清理。
 * 输入框、文本域里不触发（打字选字时不打扰）；reduced-motion 下整个关闭。
 */
export function ClickBurst() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const layer = document.createElement("div");
    layer.className = "click-burst-layer";
    layer.setAttribute("aria-hidden", "true");
    document.body.appendChild(layer);

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("input, textarea, select, [contenteditable=true]")
      ) {
        return;
      }

      const count = gsap.utils.random(5, 7, 1);
      for (let i = 0; i < count; i += 1) {
        const bit = document.createElement("i");
        bit.className = "burst-bit";
        bit.textContent = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        bit.style.color = TONE_VARS[Math.floor(Math.random() * TONE_VARS.length)];
        bit.style.left = `${event.clientX}px`;
        bit.style.top = `${event.clientY}px`;
        bit.style.fontSize = `${gsap.utils.random(10, 17, 1)}px`;
        layer.appendChild(bit);

        const angle = gsap.utils.random(0, Math.PI * 2);
        const distance = gsap.utils.random(34, 88);
        gsap.fromTo(
          bit,
          {
            xPercent: -50,
            yPercent: -50,
            scale: 0.4,
            opacity: 1,
            rotation: gsap.utils.random(-40, 40),
          },
          {
            x: Math.cos(angle) * distance,
            /* +24 让粒子整体往下坠一点，像撒糖 */
            y: Math.sin(angle) * distance + 24,
            scale: gsap.utils.random(0.9, 1.3),
            opacity: 0,
            rotation: "+=random(-90, 90)",
            duration: gsap.utils.random(0.55, 0.85),
            ease: "power2.out",
            onComplete: () => bit.remove(),
          },
        );
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      gsap.killTweensOf(layer.children);
      layer.remove();
    };
  }, []);

  return null;
}
