export type CharacterNameRejectReason =
  | "empty"
  | "contains_forbidden_token"
  | "invalid_characters"
  | "invalid_prefix"
  | "invalid_length"
  | "invalid_pattern";

export interface CharacterNameValidationResult {
  accepted: boolean;
  canonical: string | null;
  reason: CharacterNameRejectReason | null;
}

const PREFIXES = [
  "哥哥",
  "姐姐",
  "弟弟",
  "妹妹",
  "师父",
  "师尊",
  "母亲",
  "父亲",
  "养母",
  "养父",
  "伯父",
  "伯母",
  "叔父",
  "叔母",
  "前辈",
  "小姐",
  "公子",
] as const;

const FORBIDDEN_EXACT = new Set([
  "母亲",
  "父亲",
  "师父",
  "师尊",
  "哥哥",
  "姐姐",
  "弟弟",
  "妹妹",
  "养母",
  "养父",
  "伯父",
  "伯母",
  "叔父",
  "叔母",
  "前辈",
  "小姐",
  "公子",
  "主角",
  "男主",
  "女主",
  "反派",
  "配角",
]);

const FORBIDDEN_SUBSTRINGS = [
  "的",
  "就是在这",
  "现身",
  "隐于",
  "隐在",
  "隐没",
  "暗中",
  "布局",
  "夫人",
  "老太爷",
];

const FORBIDDEN_REGEXES = [
  /^(?:母|父|兄|姐|弟|妹|叔|伯|婶|姨|姑|舅)[\p{Script=Han}]{1,5}$/u,
  /在此/u,
  /在这/u,
  /[，。！？；：,.!?]/u,
  /\s/u,
];

const HAN_NAME_REGEX = /^[\p{Script=Han}]{2,6}$/u;
const HAN_DOT_NAME_REGEX = /^[\p{Script=Han}]{1,4}·[\p{Script=Han}]{1,3}$/u;
const CLAN_NAME_REGEX = /^[\p{Script=Han}]{1,5}氏$/u;

function normalizeInput(raw: string) {
  return raw
    .trim()
    .replace(/[“”"「」『』]/gu, "")
    .replace(/[•・]/gu, "·");
}

function containsForbiddenToken(value: string) {
  if (FORBIDDEN_EXACT.has(value)) {
    return true;
  }
  if (FORBIDDEN_SUBSTRINGS.some((token) => value.includes(token))) {
    return true;
  }
  return FORBIDDEN_REGEXES.some((pattern) => pattern.test(value));
}

function tryStripSinglePrefix(value: string) {
  for (const prefix of PREFIXES) {
    if (!value.startsWith(prefix)) {
      continue;
    }
    return value.slice(prefix.length).trim();
  }
  return value;
}

function isAcceptedCanonical(value: string) {
  return HAN_NAME_REGEX.test(value) || CLAN_NAME_REGEX.test(value) || HAN_DOT_NAME_REGEX.test(value);
}

export function validateCharacterName(raw: string): CharacterNameValidationResult {
  const normalized = normalizeInput(raw);
  if (!normalized) {
    return { accepted: false, canonical: null, reason: "empty" };
  }

  if (containsForbiddenToken(normalized)) {
    return { accepted: false, canonical: null, reason: "contains_forbidden_token" };
  }

  const canonical = tryStripSinglePrefix(normalized);
  if (!canonical) {
    return { accepted: false, canonical: null, reason: "invalid_prefix" };
  }
  if (containsForbiddenToken(canonical)) {
    return { accepted: false, canonical: null, reason: "contains_forbidden_token" };
  }
  if (!/^[\p{Script=Han}·]+$/u.test(canonical)) {
    return { accepted: false, canonical: null, reason: "invalid_characters" };
  }
  if (canonical.length < 2 || canonical.length > 7) {
    return { accepted: false, canonical: null, reason: "invalid_length" };
  }
  if (!isAcceptedCanonical(canonical)) {
    return { accepted: false, canonical: null, reason: "invalid_pattern" };
  }
  return { accepted: true, canonical, reason: null };
}

export function canonicalizeCharacterName(raw: string) {
  const result = validateCharacterName(raw);
  return result.accepted ? result.canonical : null;
}

export function isValidCharacterName(raw: string) {
  return validateCharacterName(raw).accepted;
}
