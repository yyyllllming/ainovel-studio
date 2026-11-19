const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const ILLEGAL_FILE_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;

export function sanitizeArtifactName(input: string, fallback = "untitled") {
  const trimmed = input.normalize("NFKC").trim();
  const cleaned = trimmed
    .replace(ILLEGAL_FILE_CHARS, "_")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .slice(0, 80);

  const safe = cleaned || fallback;
  return WINDOWS_RESERVED_NAME.test(safe) ? `_${safe}` : safe;
}
