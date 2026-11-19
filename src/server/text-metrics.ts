const HAN_REGEX = /\p{Script=Han}/gu;
const NON_HAN_WORD_REGEX = /[\p{Letter}\p{Number}]+(?:['’-][\p{Letter}\p{Number}]+)*/gu;

export function countNarrativeUnits(input: string) {
  const hanChars = input.match(HAN_REGEX)?.length ?? 0;
  const nonHanText = input.replace(HAN_REGEX, " ");
  const nonHanWords = nonHanText.match(NON_HAN_WORD_REGEX)?.length ?? 0;
  return hanChars + nonHanWords;
}

export function estimateModelTokens(input: string) {
  const hanChars = input.match(HAN_REGEX)?.length ?? 0;
  const otherChars = input.replace(HAN_REGEX, "").length;
  return Math.max(1, Math.ceil(hanChars * 0.7 + otherChars / 4));
}
