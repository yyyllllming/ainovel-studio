"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";

gsap.registerPlugin(useGSAP);

/** 路由级转场：每次导航时整页内容轻轻浮入，叠加页面内组件的弹性入场。 */
export default function Template({
  children,
}: {
  children: React.ReactNode;
}) {
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (!scope.current) return;
      const mm = gsap.matchMedia();
      mm.add(
        {
          motionOk: "(prefers-reduced-motion: no-preference)",
          reduceMotion: "(prefers-reduced-motion: reduce)",
        },
        (mmContext) => {
          const reduceMotion = Boolean(mmContext.conditions?.reduceMotion);
          gsap.from(scope.current, {
            autoAlpha: 0,
            y: 16,
            duration: reduceMotion ? 0 : 0.42,
            ease: "back.out(1.2)",
            clearProps: "all",
          });
        },
      );
      return () => mm.revert();
    },
    { scope },
  );

  return <div ref={scope}>{children}</div>;
}
