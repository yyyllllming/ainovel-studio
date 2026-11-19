/** 马卡龙五色轮换：卡片网格按索引取色，对应 globals.css 的 [data-tone]。 */
export const TONES = ["pink", "violet", "sky", "mint", "peach"] as const;

export type Tone = (typeof TONES)[number];

export function toneAt(index: number): Tone {
  return TONES[index % TONES.length];
}
