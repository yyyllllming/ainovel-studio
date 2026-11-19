"use client";

import clsx from "clsx";

/** 塔菲小唐人笑循环动图，用作 logo / 空状态头像。 */
export function TaffyMark({
  className,
  size = 36,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <img
      src="/taffy-laugh.gif"
      alt=""
      width={size}
      height={size}
      className={clsx("taffy-mark", className)}
      draggable={false}
    />
  );
}
