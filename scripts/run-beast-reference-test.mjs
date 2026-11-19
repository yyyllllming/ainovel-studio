import { mkdir, readFile, appendFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL = process.env.AINOVEL_BASE_URL ?? "http://localhost:3000";
const PROJECT_ID = process.env.AINOVEL_PROJECT_ID ?? "";
const REFERENCE_FILE = process.env.AINOVEL_REFERENCE_FILE ?? "";
const REFERENCE_TITLE = process.env.AINOVEL_REFERENCE_TITLE ?? "参考书";
const REFERENCE_AUTHOR = process.env.AINOVEL_REFERENCE_AUTHOR ?? "未知作者";
const TARGET_CHAPTERS = Number(process.env.AINOVEL_TARGET_CHAPTERS ?? 10);
const POLL_MS = Number(process.env.AINOVEL_POLL_MS ?? 15000);
const EXISTING_IMPORT_ID = process.env.AINOVEL_EXISTING_IMPORT_ID ?? "";
const EXISTING_SNAPSHOT_ID = process.env.AINOVEL_EXISTING_SNAPSHOT_ID ?? "";
const ATTACH_ONLY = /^(1|true|yes)$/i.test(process.env.AINOVEL_ATTACH_ONLY ?? "");
const FORCED_EVALUATOR_PROFILE_ID = process.env.AINOVEL_EVALUATOR_PROFILE_ID ?? "";
const REPORT_DIR = path.resolve(process.cwd(), "tmp", "monitor-reports");
const REPORT_PATH = path.join(
  REPORT_DIR,
  `beast-reference-test-${new Date().toISOString().replaceAll(":", "-")}.jsonl`,
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function trimErrorMessage(message) {
  if (typeof message !== "string") {
    return String(message ?? "未知错误");
  }
  return message.length > 800 ? `${message.slice(0, 800)} ...[truncated]` : message;
}

function isMonitorAlreadyRunningError(message) {
  const normalized = trimErrorMessage(message);
  return normalized.includes("当前已有正在进行中的写作任务")
    || normalized.includes("检测到锁文件")
    || normalized.includes("该项目正在运行中");
}

export function shouldTreatMonitorResolveErrorAsRecovered(error, progress, chapterNo) {
  const message = trimErrorMessage(error instanceof Error ? error.message : error);
  if (!isMonitorAlreadyRunningError(message)) {
    return false;
  }
  if (!progress || typeof progress !== "object") {
    return false;
  }

  const currentChapter = Number(progress.currentChapter ?? 0);
  if (Number.isInteger(currentChapter) && currentChapter > chapterNo) {
    return true;
  }

  return Boolean(progress.running) || progress.stage !== "manual_review";
}

export function shouldRetryMonitorLoopError(error) {
  const message = trimErrorMessage(error instanceof Error ? error.message : error);
  return isMonitorAlreadyRunningError(message)
    || /^\s*<!doctype html/i.test(message)
    || /^\s*<html/i.test(message)
    || message.includes("Unexpected token '<'")
    || message.includes("fetch failed")
    || message.includes("ECONNREFUSED")
    || message.includes("ETIMEDOUT")
    || message.includes("socket hang up")
    || message.includes("monitor_progress_response_invalid")
    || message.includes("monitor_project_response_invalid");
}

export function getAttachModeSkippedChapters(projectPayload, targetChapters, currentChapter) {
  const latestCompletedChapter = Math.max(0, Number(currentChapter ?? 0) - 1);
  if (latestCompletedChapter <= 1) {
    return [];
  }
  return getMonitorCandidateChapters(projectPayload, targetChapters)
    .filter((chapterNo) => chapterNo < latestCompletedChapter);
}

function buildApiUrl(pathname, method) {
  const url = new URL(pathname, BASE_URL);
  if (method === "GET" || method === "HEAD") {
    url.searchParams.set("_ts", `${Date.now()}`);
  }
  return url.toString();
}

function getPlannerTracePath(projectId, chapterNo) {
  return path.resolve(
    process.cwd(),
    "projects",
    projectId,
    "blueprints",
    "traces",
    `chapter_${String(chapterNo).padStart(3, "0")}_planner_trace.json`,
  );
}

export function summarizePlannerQualityFromTrace(trace) {
  if (!trace || typeof trace !== "object") {
    return null;
  }

  const selectedCandidateIndex = Number.isInteger(trace.selectedCandidateIndex)
    ? Number(trace.selectedCandidateIndex)
    : null;
  const candidateAttempts = Array.isArray(trace.candidateAttempts) ? trace.candidateAttempts : [];
  const selectedAttempt =
    selectedCandidateIndex !== null && selectedCandidateIndex >= 0 && selectedCandidateIndex < candidateAttempts.length
      ? candidateAttempts[selectedCandidateIndex]
      : null;
  const traceQuality = trace.plannerQuality && typeof trace.plannerQuality === "object"
    ? trace.plannerQuality
    : null;
  const fallbackReason = typeof trace.fallbackReason === "string" && trace.fallbackReason.trim()
    ? trace.fallbackReason.trim()
    : null;
  const failureReasons = [
    ...(Array.isArray(traceQuality?.failureReasons) ? traceQuality.failureReasons : []),
    ...(Array.isArray(selectedAttempt?.verification?.reasons) ? selectedAttempt.verification.reasons : []),
    ...(!trace.repairVerification?.pass && Array.isArray(trace.repairVerification?.reasons) ? trace.repairVerification.reasons : []),
    ...(fallbackReason ? [fallbackReason] : []),
  ];

  return {
    candidateAttempts:
      Number.isInteger(traceQuality?.candidateAttempts) ? traceQuality.candidateAttempts : candidateAttempts.length,
    selectedScore:
      typeof traceQuality?.selectedScore === "number"
        ? traceQuality.selectedScore
        : typeof trace.selectedScore === "number"
          ? trace.selectedScore
          : null,
    selectedReason:
      typeof traceQuality?.selectedReason === "string" && traceQuality.selectedReason.trim()
        ? traceQuality.selectedReason.trim()
        : typeof trace.selectedReason === "string"
          ? trace.selectedReason.trim()
          : "",
    repairUsed: Boolean(traceQuality?.repairUsed ?? trace.repairUsed),
    fallbackUsed: Boolean(traceQuality?.fallbackUsed ?? trace.fallbackUsed),
    failureReasons: [...new Set(failureReasons.filter((entry) => typeof entry === "string" && entry.trim()))].slice(0, 6),
  };
}

export function summarizeLocalFlavorSignals(signals) {
  if (!signals || typeof signals !== "object") {
    return null;
  }

  const warnings = [
    ...(Array.isArray(signals.notes) ? signals.notes : []),
    ...(Array.isArray(signals.warnings) ? signals.warnings : []),
  ].filter((entry) => typeof entry === "string" && entry.trim());
  const dominantLead =
    signals.dominantLead && typeof signals.dominantLead === "object"
      ? `${signals.dominantLead.lead}×${signals.dominantLead.count}`
      : null;

  return {
    severity: typeof signals.severity === "string" ? signals.severity : "ok",
    score: typeof signals.score === "number" ? signals.score : 0,
    topWarnings: [...new Set(warnings)].slice(0, 4),
    momentMarkerCount: typeof signals.momentMarkerCount === "number" ? signals.momentMarkerCount : 0,
    explanationLeadCount: typeof signals.explanationLeadCount === "number" ? signals.explanationLeadCount : 0,
    judgmentLeadCount: typeof signals.judgmentLeadCount === "number" ? signals.judgmentLeadCount : 0,
    phraseReuseHits: Array.isArray(signals.phraseReuseHits)
      ? signals.phraseReuseHits
        .filter((entry) => entry && typeof entry.phrase === "string" && typeof entry.count === "number")
        .slice(0, 3)
        .map((entry) => `${entry.phrase}×${entry.count}`)
      : [],
    pronounLeadCount: typeof signals.pronounLeadCount === "number" ? signals.pronounLeadCount : 0,
    simileCount: typeof signals.simileCount === "number" ? signals.simileCount : 0,
    contrastTemplateCount: typeof signals.contrastTemplateCount === "number" ? signals.contrastTemplateCount : 0,
    abruptTurnCount: typeof signals.abruptTurnCount === "number" ? signals.abruptTurnCount : 0,
    dominantLead,
  };
}

async function readPlannerQuality(projectId, chapterNo) {
  try {
    const raw = await readFile(getPlannerTracePath(projectId, chapterNo), "utf8");
    return summarizePlannerQualityFromTrace(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function readLocalFlavorSummary(chapterPayload) {
  const latestReview = Array.isArray(chapterPayload?.reviews) ? chapterPayload.reviews[0] ?? null : null;
  if (latestReview?.localFlavorSignals) {
    return summarizeLocalFlavorSignals(latestReview.localFlavorSignals);
  }
  if (typeof latestReview?.path !== "string" || !latestReview.path.trim()) {
    return null;
  }
  try {
    const raw = await readFile(latestReview.path, "utf8");
    const artifact = JSON.parse(raw);
    return summarizeLocalFlavorSignals(artifact?.localFlavorSignals ?? null);
  } catch {
    return null;
  }
}

async function writeReport(entry) {
  await appendFile(REPORT_PATH, `${JSON.stringify(entry, null, 0)}\n`, "utf8");
}

async function log(level, message, extra = {}) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  console.log(line);
  await writeReport({ timestamp, level, message, ...extra });
}

async function apiFetch(pathname, init = {}) {
  const method = String(init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers ?? {});
  if (method === "GET" || method === "HEAD") {
    headers.set("Cache-Control", "no-cache");
    headers.set("Pragma", "no-cache");
  }

  const requestInit = {
    ...init,
    method,
    headers,
  };
  if (method === "GET" || method === "HEAD") {
    requestInit.cache = "no-store";
  }

  const response = await fetch(buildApiUrl(pathname, method), requestInit);
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    const detail = parsed?.error ?? parsed?.message ?? text ?? `HTTP ${response.status}`;
    throw new Error(trimErrorMessage(detail));
  }
  if (!parsed && /^\s*<!doctype html/i.test(text)) {
    throw new Error(trimErrorMessage(text));
  }
  return parsed;
}

function buildChatCompletionsUrls(baseUrl) {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const primary = new URL("chat/completions", normalizedBase).toString();
  const base = new URL(normalizedBase);
  const pathname = base.pathname.replace(/\/+$/, "");
  const fallbackNeeded = pathname !== "/v1";
  const urls = [primary];
  if (fallbackNeeded) {
    urls.push(new URL("v1/chat/completions", normalizedBase).toString());
  }
  return [...new Set(urls)];
}

async function postChatCompletion(profile, payload) {
  let lastError = null;
  for (const url of buildChatCompletionsUrls(profile.baseUrl)) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${profile.apiKey}`,
      },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    if (response.ok && text.trim().startsWith("{")) {
      return text;
    }
    lastError = new Error(trimErrorMessage(text || `HTTP ${response.status}`));
  }
  throw lastError ?? new Error("调用模型失败");
}

async function getProject() {
  return apiFetch(`/api/projects/${PROJECT_ID}`);
}

async function getProgress() {
  return apiFetch(`/api/projects/${PROJECT_ID}/run/progress`);
}

async function pauseRun() {
  return apiFetch(`/api/projects/${PROJECT_ID}/run/pause`, { method: "POST" });
}

async function resumeRun() {
  return apiFetch(`/api/projects/${PROJECT_ID}/run/resume`, { method: "POST" });
}

async function startRun(fromChapter = 1) {
  return apiFetch(`/api/projects/${PROJECT_ID}/run/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fromChapter }),
  });
}

async function deleteRange(startChapter, endChapter) {
  return apiFetch(`/api/projects/${PROJECT_ID}/chapters/delete-range`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ startChapter, endChapter }),
  });
}

async function updateAssignments(assignments) {
  return apiFetch(`/api/projects/${PROJECT_ID}/assignments`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assignments }),
  });
}

async function getChapter(chapterNo) {
  return apiFetch(`/api/projects/${PROJECT_ID}/chapters/${chapterNo}`);
}

async function resolveManualReview(chapterNo, action) {
  return apiFetch(`/api/projects/${PROJECT_ID}/chapters/${chapterNo}/manual-review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
}

async function listStyleImports() {
  return apiFetch(`/api/projects/${PROJECT_ID}/foundation/style-imports`);
}

async function importStyleReference() {
  const buffer = await readFile(REFERENCE_FILE);
  const form = new FormData();
  form.set("title", REFERENCE_TITLE);
  form.set("author", REFERENCE_AUTHOR);
  form.set(
    "file",
    new File([buffer], path.basename(REFERENCE_FILE), { type: "text/plain" }),
  );
  return apiFetch(`/api/projects/${PROJECT_ID}/foundation/style-imports`, {
    method: "POST",
    body: form,
  });
}

async function createStyleSnapshot(sourceIds) {
  return apiFetch(`/api/projects/${PROJECT_ID}/foundation/style-snapshots`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "book", sourceIds }),
  });
}

async function applyStyleSnapshot(snapshotId) {
  return apiFetch(`/api/projects/${PROJECT_ID}/foundation/style-snapshots/${snapshotId}/apply`, {
    method: "POST",
  });
}

async function waitForServer() {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      await getProject();
      return;
    } catch (error) {
      if (attempt === 20) {
        throw error;
      }
      await sleep(1500);
    }
  }
}

async function readProfiles() {
  const raw = await readFile(path.resolve(process.cwd(), "config", "llm-profiles.json"), "utf8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed?.profiles) ? parsed.profiles.filter((item) => item?.enabled) : [];
}

function rankEvaluatorProfiles(projectPayload, profiles) {
  const assignments = Array.isArray(projectPayload?.assignments) ? projectPayload.assignments : [];
  const assignmentProfileIds = new Set(assignments.map((item) => item.profileId));
  const writerModel = assignments.find((item) => item.role === "writer")?.model ?? "";
  const scored = profiles
    .map((profile) => ({
      profile,
      score:
        (!assignmentProfileIds.has(profile.id) ? 100 : 0)
        + (profile.defaultModel?.includes("gpt-5.4") ? 10 : 0)
        + (profile.defaultModel !== writerModel ? 1 : 0),
    }))
    .sort((left, right) => right.score - left.score);
  return scored.map((item) => item.profile);
}

async function probeProfile(profile) {
  const payload = {
    model: profile.defaultModel,
    temperature: 0,
    max_tokens: 32,
    messages: [{ role: "user", content: "只回复 OK" }],
  };
  return postChatCompletion(profile, payload);
}

export async function selectEvaluatorProfile(
  projectPayload,
  profiles,
  forcedProfileId = FORCED_EVALUATOR_PROFILE_ID,
) {
  const failures = [];

  if (forcedProfileId) {
    const forcedProfile = profiles.find((profile) => profile.id === forcedProfileId) ?? null;
    if (!forcedProfile) {
      failures.push({
        profileId: forcedProfileId,
        model: null,
        error: "指定的第三方评估 profile 不存在或未启用",
      });
      return { profile: null, failures };
    }

    try {
      const text = await probeProfile(forcedProfile);
      if (!text.trim().startsWith("{")) {
        throw new Error("评估线路响应不是 OpenAI JSON，而是网页/其他内容");
      }
      return { profile: forcedProfile, failures };
    } catch (error) {
      failures.push({
        profileId: forcedProfile.id,
        model: forcedProfile.defaultModel ?? null,
        error: trimErrorMessage(error instanceof Error ? error.message : error),
      });
      return { profile: null, failures };
    }
  }

  for (const profile of rankEvaluatorProfiles(projectPayload, profiles)) {
    try {
      const text = await probeProfile(profile);
      if (!text.trim().startsWith("{")) {
        throw new Error("评估线路响应不是 OpenAI JSON，而是网页/其他内容");
      }
      return { profile, failures };
    } catch (error) {
      failures.push({
        profileId: profile.id,
        model: profile.defaultModel ?? null,
        error: trimErrorMessage(error instanceof Error ? error.message : error),
      });
    }
  }

  return { profile: null, failures };
}

export function collectMonitorCharterSignals(projectPayload, chapterPayload) {
  const writingCharter = projectPayload?.foundation?.styleProfile?.writingCharter ?? null;
  const latestReview = Array.isArray(chapterPayload?.reviews) ? chapterPayload.reviews[0] ?? null : null;
  const charterViolations = Array.isArray(latestReview?.charterViolations)
    ? latestReview.charterViolations
    : [];
  const styleChecklistHits = Array.isArray(latestReview?.styleChecklistHits)
    ? latestReview.styleChecklistHits
    : [];

  return {
    charterSummary: writingCharter
      ? `章长=${writingCharter.chapterLengthRule}；机制露出=${writingCharter.mechanismRevealRule}；机制禁区=${(writingCharter.mechanismRevealRedlines ?? []).join("；") || "无"}`
      : "作者习惯卡：无",
    charterViolations,
    styleChecklistHits,
    mechanismViolations: charterViolations.filter((entry) => entry.scope === "mechanism"),
    budgetHitLabels: charterViolations.map((entry) => entry.label),
    storyProgression: latestReview?.storyProgression ?? null,
    genreFulfillment: latestReview?.genreFulfillment ?? null,
    loopRisk: latestReview?.loopRisk ?? null,
    primaryDeltaDelivered: latestReview?.primaryDeltaDelivered ?? null,
    stuckDimensions: Array.isArray(latestReview?.stuckDimensions) ? latestReview.stuckDimensions : [],
  };
}

export function decideMonitorManualReviewAction(chapterPayload) {
  const manualReview = chapterPayload?.manualReview ?? null;

  if (!manualReview?.awaiting) {
    return {
      action: null,
      reason: "not_waiting",
      requiresWindowRestart: false,
      restartFromChapter: null,
    };
  }

  if (manualReview.requiresWindowRestart && typeof manualReview.earliestAffectedChapter === "number") {
    return {
      action: "retry_chapter",
      reason: "window_restart",
      requiresWindowRestart: true,
      restartFromChapter: manualReview.earliestAffectedChapter,
    };
  }

  if (manualReview.canAutoPick) {
    return {
      action: "auto_pick_version",
      reason: "auto_pick",
      requiresWindowRestart: false,
      restartFromChapter: null,
    };
  }

  if (manualReview.canApprove) {
    return {
      action: "approve_continue",
      reason: "approve_continue",
      requiresWindowRestart: false,
      restartFromChapter: null,
    };
  }

  return {
    action: null,
    reason: "unsupported_manual_review",
    requiresWindowRestart: Boolean(manualReview.requiresWindowRestart),
    restartFromChapter:
      typeof manualReview.earliestAffectedChapter === "number" ? manualReview.earliestAffectedChapter : null,
  };
}

function clearEvaluatedChaptersFrom(evaluated, fromChapter) {
  const removed = [];
  for (const chapterNo of [...evaluated]) {
    if (chapterNo >= fromChapter) {
      evaluated.delete(chapterNo);
      removed.push(chapterNo);
    }
  }
  return removed.sort((left, right) => left - right);
}

export function getMonitorCandidateChapters(projectPayload, targetChapters) {
  const writtenChapters = Array.isArray(projectPayload?.writtenChapters) ? projectPayload.writtenChapters : [];
  return [...new Set(
    writtenChapters
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0 && value <= targetChapters),
  )].sort((left, right) => left - right);
}

async function readRecentBriefSummaries(projectId, chapterNo, limit = 2) {
  const summaries = [];
  for (let cursor = Math.max(1, chapterNo - limit); cursor < chapterNo; cursor += 1) {
    const filePath = path.resolve(
      process.cwd(),
      "projects",
      projectId,
      "chapters",
      "summaries",
      `chapter_${String(cursor).padStart(3, "0")}_brief.md`,
    );
    try {
      const content = (await readFile(filePath, "utf8")).trim();
      if (content) {
        summaries.push(`第 ${cursor} 章：${content}`);
      }
    } catch {
      // Ignore missing summary files.
    }
  }
  return summaries;
}

export function buildMonitorEvaluationPrompt({
  projectPayload,
  chapterNo,
  chapterPayload,
  charterSignals,
  recentBriefSummaries,
  plannerQuality,
  localFlavorSignals,
}) {
  const styleDigest = projectPayload?.foundation?.styleDigest || "";
  const styleExemplars = Array.isArray(projectPayload?.foundation?.styleExemplars)
    ? projectPayload.foundation.styleExemplars
    : [];
  const writingCharter = projectPayload?.foundation?.styleProfile?.writingCharter ?? null;
  const activePacks = Array.isArray(projectPayload?.project?.storyContract?.genreObligationPacks)
    ? projectPayload.project.storyContract.genreObligationPacks
      .filter((entry) => entry?.active)
      .map((entry) => entry.id)
    : [];
  const blueprint = chapterPayload?.blueprint
    ? JSON.stringify(chapterPayload.blueprint, null, 2)
    : "无";

  return [
    "你是独立第三方小说评估员，只做监控，不做改写建议执行。",
    "请额外重点识别章节是否带有明显 AI 味，包括模板化句式、过度工整排比、泛化情绪词、解释先于行动、悬浮比喻、重复总结、机械转折、故作文学化等问题。",
    "请同时判断三件事：一，本章剧情是否真的往前推进；二，本章是否兑现当前题材承诺；三，本章是否在同一地点/同一目标/同一对手上空转打转。",
    "请根据给定章节正文，输出严格 JSON，不要输出任何额外说明。",
    "JSON schema:",
    "{\"overall\":\"pass|watch|risk\",\"scores\":{\"coherence\":0-100,\"style_fit\":0-100,\"scene_drive\":0-100,\"readability\":0-100,\"hook\":0-100},\"storyProgression\":{\"risk\":\"pass|watch|risk\",\"score\":0-100,\"summary\":\"不超过80字\",\"advancements\":[\"最多4条，短句\"],\"stallSignals\":[\"最多4条，短句\"]},\"genreFulfillment\":{\"risk\":\"pass|watch|risk\",\"score\":0-100,\"summary\":\"不超过80字\",\"present\":[\"最多4条，短句\"],\"missing\":[\"最多4条，短句\"],\"activePacks\":[\"最多3条\"]},\"loopRisk\":{\"risk\":\"pass|watch|risk\",\"score\":0-100,\"summary\":\"不超过80字\",\"repetitionAxes\":[\"最多4条，短句\"],\"stuckDimensions\":[\"最多4条，短句\"]},\"primaryDeltaDelivered\":\"situation_shift|objective_shift|information_shift|relationship_shift|power_shift|world_shift|cost_shift|null\",\"stuckDimensions\":[\"最多4条，短句\"],\"aiFlavor\":{\"risk\":\"low|watch|high\",\"score\":0-100,\"summary\":\"不超过80字\",\"signals\":[\"最多5条，短句\"]},\"charter\":{\"risk\":\"pass|watch|risk\",\"summary\":\"不超过80字\",\"budgetHits\":[\"最多6条，直接复用作者习惯卡术语\"],\"mechanismRisk\":\"none|watch|explicit_summary|triad\"},\"summary\":\"不超过120字\",\"findings\":[\"最多5条，短句\"],\"riskFlags\":[\"可为空\"],\"nextWatch\":\"下一章最该盯的一点\"}",
    `项目：${projectPayload?.project?.title ?? "未知项目"}`,
    `题材：${projectPayload?.project?.genre ?? "未知题材"}`,
    `章节：第 ${chapterNo} 章`,
    `项目 premise：${projectPayload?.project?.premise ?? ""}`,
    `当前卷目标：${projectPayload?.project?.storyContract?.volumes?.find?.((item) => item.volumeNo === projectPayload?.project?.storyContract?.currentVolume)?.goal ?? projectPayload?.project?.storyContract?.endingPromise ?? ""}`,
    styleDigest ? `风格 digest：${styleDigest}` : "风格 digest：无",
    writingCharter
      ? `作者习惯卡：${charterSignals.charterSummary}`
      : "作者习惯卡：无",
    recentBriefSummaries.length ? `前情摘要：\n${recentBriefSummaries.join("\n")}` : "前情摘要：无",
    activePacks.length ? `激活题材包：${activePacks.join("、")}` : "激活题材包：core-only",
    charterSignals.budgetHitLabels.length
      ? `当前本地预算命中：${JSON.stringify(charterSignals.charterViolations)}`
      : "当前本地预算命中：无",
    charterSignals.styleChecklistHits.length
      ? `当前本地风格命中：${JSON.stringify(charterSignals.styleChecklistHits)}`
      : "当前本地风格命中：无",
    charterSignals.storyProgression
      ? `当前本地推进评估：${JSON.stringify(charterSignals.storyProgression)}`
      : "当前本地推进评估：无",
    charterSignals.genreFulfillment
      ? `当前本地题材履约：${JSON.stringify(charterSignals.genreFulfillment)}`
      : "当前本地题材履约：无",
    charterSignals.loopRisk
      ? `当前本地循环风险：${JSON.stringify(charterSignals.loopRisk)}`
      : "当前本地循环风险：无",
    charterSignals.primaryDeltaDelivered
      ? `当前本地主推进 delta：${charterSignals.primaryDeltaDelivered}`
      : "当前本地主推进 delta：无",
    charterSignals.stuckDimensions.length
      ? `当前本地卡住维度：${charterSignals.stuckDimensions.join("、")}`
      : "当前本地卡住维度：无",
    plannerQuality
      ? `当前本地蓝图入口质量：${JSON.stringify(plannerQuality)}`
      : "当前本地蓝图入口质量：无",
    localFlavorSignals
      ? `当前本地 prose 信号：${JSON.stringify(localFlavorSignals)}`
      : "当前本地 prose 信号：无",
    styleExemplars.length > 0 ? `风格 exemplars：${styleExemplars.slice(0, 2).join("\n---\n")}` : "风格 exemplars：无",
    `蓝图：${blueprint}`,
    "storyProgression 必须判断这一章是否真的把主线往前推了一格。推进至少要体现为：进入新地带、拿到新线索、确认新禁忌、引出新势力/更大存在、改写目标或局势之一。单纯把同一场追逃/打斗拖长，不算推进。",
    activePacks.includes("mythic_beastiary")
      ? "genreFulfillment 若激活 mythic_beastiary，必须判断这一章是否真有山海经/洪荒/异兽志气质：巨兽体量、古怪器官、活着的灵药、会回应的山川、禁区生态、部族祭痕、异兽习性或诡异地貌。只有狼、鸟、追逃和打斗，不足以算洪荒感。"
      : activePacks.includes("romance")
        ? "genreFulfillment 若激活 romance，必须判断这一章是否真让关系状态、立场或情感目标发生变化，而不是只重复情绪和互动表面。"
        : "genreFulfillment 必须判断这一章是否兑现了当前题材承诺，而不是只靠通用冲突撑篇幅。",
    "loopRisk 必须指出是否还在重复同一地点、同一目标、同一对手或同一动作模式；如果只是 cost_shift 或拖长旧冲突，要直接判 risk 或至少 watch。",
    "如果发现章末策略、机制露出策略、转场预算、比喻预算、主体起句预算或母题复用预算失守，请在 charter.budgetHits 里直接复用这些术语。",
    "如果机制类信息写成了解释先行、显性总结句或解释 -> 验证 -> 总结三段式，必须写清 charter.mechanismRisk。",
    "如果 AI 味不明显，也必须明确写 aiFlavor.risk=low，并说明为什么不像模板化 AI 文。",
    "章节正文如下：",
    chapterPayload?.content ?? "",
  ].join("\n\n");
}

async function evaluateChapter(profile, projectPayload, chapterNo, chapterPayload) {
  const charterSignals = collectMonitorCharterSignals(projectPayload, chapterPayload);
  const plannerQuality = await readPlannerQuality(
    projectPayload?.project?.id ?? PROJECT_ID,
    chapterNo,
  );
  const localFlavorSignals = await readLocalFlavorSummary(chapterPayload);
  const recentBriefSummaries = await readRecentBriefSummaries(
    projectPayload?.project?.id ?? PROJECT_ID,
    chapterNo,
  );
  const prompt = buildMonitorEvaluationPrompt({
    projectPayload,
    chapterNo,
    chapterPayload,
    charterSignals,
    recentBriefSummaries,
    plannerQuality,
    localFlavorSignals,
  });

  const text = await postChatCompletion(profile, {
    model: profile.defaultModel,
    temperature: 0.15,
    max_tokens: 900,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });

  const parsed = JSON.parse(text);
  const content = parsed?.choices?.[0]?.message?.content ?? "";
  return {
    evaluation: JSON.parse(content),
    plannerQuality,
    localFlavorSignals,
  };
}

async function ensureManualReviewResolved(progress, evaluated) {
  if (progress.stage !== "manual_review") {
    return { handled: false, shouldStop: false };
  }

  const chapterNo = progress.currentChapter;
  const chapterPayload = await getChapter(chapterNo);
  const decision = decideMonitorManualReviewAction(chapterPayload);

  if (!decision.action) {
    await log("warning", `第 ${chapterNo} 章进入 manual_review，但当前无法自动放行`, {
      chapterNo,
      manualReview: chapterPayload?.manualReview ?? null,
      autoStop: true,
      stopReason: decision.reason,
    });
    return {
      handled: false,
      shouldStop: true,
      chapterNo,
      decision,
      manualReview: chapterPayload?.manualReview ?? null,
    };
  }

  try {
    await resolveManualReview(chapterNo, decision.action);
  } catch (error) {
    const latestProgress = await getProgress().catch(() => null);
    if (shouldTreatMonitorResolveErrorAsRecovered(error, latestProgress, chapterNo)) {
      await log("info", `第 ${chapterNo} 章人工审阅已由其他动作放行，监控继续附着`, {
        chapterNo,
        currentStage: latestProgress?.stage ?? null,
        currentChapter: latestProgress?.currentChapter ?? null,
        running: latestProgress?.running ?? null,
        recoveredFrom: trimErrorMessage(error instanceof Error ? error.message : error),
      });
      return {
        handled: true,
        shouldStop: false,
        decision,
        recovered: true,
      };
    }
    throw error;
  }
  const clearedEvaluations = decision.restartFromChapter !== null
    ? clearEvaluatedChaptersFrom(evaluated, decision.restartFromChapter)
    : [];
  await log("warning", `第 ${chapterNo} 章进入 manual_review，已自动执行 ${decision.action}`, {
    chapterNo,
    action: decision.action,
    manualReviewReason: decision.reason,
    windowConflict: decision.requiresWindowRestart,
    restartFromChapter: decision.restartFromChapter,
    clearedEvaluations,
  });
  return {
    handled: true,
    shouldStop: false,
    decision,
    clearedEvaluations,
  };
}

async function ensureRunnableAssignments(projectPayload, profiles, fallbackProfile) {
  const assignments = Array.isArray(projectPayload?.assignments) ? projectPayload.assignments : [];
  const writerAssignment = assignments.find((item) => item.role === "writer");
  const assignedProfile = profiles.find((item) => item.id === writerAssignment?.profileId) ?? null;

  if (!assignedProfile) {
    const migrated = assignments.map((item) => ({
      ...item,
      profileId: fallbackProfile.id,
      model: fallbackProfile.defaultModel,
    }));
    await updateAssignments(migrated);
    await log("warning", "当前项目缺少可用的 writer profile，已统一切到稳定线路", {
      fallbackModel: fallbackProfile.defaultModel,
    });
    return;
  }

  try {
    const text = await probeProfile(assignedProfile);
    if (!text.trim().startsWith("{")) {
      throw new Error("生成线路响应不是 OpenAI JSON，而是网页/其他内容");
    }
  } catch (error) {
    const migrated = assignments.map((item) => ({
      ...item,
      profileId: fallbackProfile.id,
      model: fallbackProfile.defaultModel,
    }));
    await updateAssignments(migrated);
    await log("warning", "当前项目生成线路不可用，已统一切到稳定线路", {
      fromModel: writerAssignment?.model ?? null,
      toModel: fallbackProfile.defaultModel,
      error: trimErrorMessage(error instanceof Error ? error.message : error),
    });
  }
}

export async function main() {
  const needsReferenceFile = !ATTACH_ONLY && !EXISTING_SNAPSHOT_ID && !EXISTING_IMPORT_ID;
  if (!PROJECT_ID || (needsReferenceFile && !REFERENCE_FILE)) {
    console.error(
      [
        "缺少必需环境变量：",
        !PROJECT_ID ? "- AINOVEL_PROJECT_ID：目标项目 ID" : null,
        needsReferenceFile && !REFERENCE_FILE
          ? "- AINOVEL_REFERENCE_FILE：参考书 txt 路径（设置 AINOVEL_ATTACH_ONLY / AINOVEL_EXISTING_SNAPSHOT_ID / AINOVEL_EXISTING_IMPORT_ID 时可省略）"
          : null,
        "用法: AINOVEL_PROJECT_ID=<projectId> AINOVEL_REFERENCE_FILE=<参考书txt路径> node scripts/run-beast-reference-test.mjs",
      ].filter(Boolean).join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  await mkdir(REPORT_DIR, { recursive: true });
  await writeFile(REPORT_PATH, "", "utf8");

  await log("info", "等待本地 Ainovel API 服务可用", {
    baseUrl: BASE_URL,
    projectId: PROJECT_ID,
    targetChapters: TARGET_CHAPTERS,
  });
  await waitForServer();

  const initialProject = await getProject();
  const project = initialProject.project ?? initialProject;
  const profiles = await readProfiles();
  const evaluatorSelection = await selectEvaluatorProfile(initialProject, profiles);
  const evaluatorProfile = evaluatorSelection.profile;
  if (!evaluatorProfile) {
    throw new Error(
      `未找到可用的第三方评估 profile：${JSON.stringify(evaluatorSelection.failures.slice(0, 5))}`,
    );
  }

  await log("info", "第三方评估线路已选定", {
    evaluatorProfileId: evaluatorProfile.id,
    evaluatorModel: evaluatorProfile.defaultModel,
    attachOnly: ATTACH_ONLY,
  });

  await ensureRunnableAssignments(initialProject, profiles, evaluatorProfile);

  await log("info", "第三方评估模型连通性检查通过", {
    evaluatorModel: evaluatorProfile.defaultModel,
  });

  if (!ATTACH_ONLY) {
    try {
      await pauseRun();
      await log("info", "已暂停旧的自动写作任务");
    } catch (error) {
      await log("warning", "暂停旧任务时返回异常，继续后续清理", {
        error: trimErrorMessage(error instanceof Error ? error.message : error),
      });
    }

    const maxChapter = Number(project?.hardChapterCap ?? project?.targetChapters ?? TARGET_CHAPTERS);
    await deleteRange(1, maxChapter);
    await log("info", `已清空第 1 章到第 ${maxChapter} 章的已有正文产物`, { maxChapter });

    let snapshot = null;

    if (EXISTING_SNAPSHOT_ID) {
      snapshot = { id: EXISTING_SNAPSHOT_ID };
      await log("info", "复用已有 style snapshot", { snapshotId: EXISTING_SNAPSHOT_ID });
    } else {
      let importId = EXISTING_IMPORT_ID;
      if (!importId) {
        const existingImports = await listStyleImports();
        await log("info", "读取现有 style imports 完成", {
          existingImports: Array.isArray(existingImports?.imports) ? existingImports.imports.length : 0,
        });

        const importResult = await importStyleReference();
        const imported = importResult.import;
        importId = imported.id;
        await log("info", "参考书导入完成", {
          importId: imported.id,
          title: imported.title,
          wordCount: imported.wordCount,
          chapterCount: imported.chapterCount,
          confidence: imported.confidence,
        });
      } else {
        await log("info", "复用已有导入源生成 style snapshot", { importId });
      }

      const snapshotResult = await createStyleSnapshot([importId]);
      snapshot = snapshotResult.snapshot;
      await log("info", "style snapshot 生成完成", {
        snapshotId: snapshot.id,
        version: snapshot.version,
        confidence: snapshot.confidence,
        digestLength: snapshot.styleDigest?.length ?? 0,
        exemplarCount: Array.isArray(snapshot.styleExemplars) ? snapshot.styleExemplars.length : 0,
      });
    }

    await applyStyleSnapshot(snapshot.id);
    await log("info", "style snapshot apply 完成，已切换到 active style", {
      snapshotId: snapshot.id,
      version: snapshot.version,
    });

    try {
      await startRun(1);
      await log("info", "已从第 1 章启动自动写作");
    } catch (error) {
      const message = trimErrorMessage(error instanceof Error ? error.message : error);
      if (message.includes("当前已有正在进行中的写作任务")) {
        await log("warning", "检测到已有写作任务在运行，已转为附着监控模式");
      } else {
        throw error;
      }
    }
  } else {
    await log("info", "附着当前写作任务继续监控，不执行清空、导入和重启");
  }

  const evaluated = new Set();
  let lastStage = "";
  let lastRunning = null;
  let lastResumeAt = 0;
  let attachHistorySeeded = false;

  while (true) {
    try {
      const progress = await getProgress();
      if (!progress || typeof progress !== "object") {
        throw new Error("monitor_progress_response_invalid");
      }

      if (progress.stage !== lastStage || progress.running !== lastRunning) {
        await log("info", `运行状态更新：stage=${progress.stage} running=${progress.running}`, {
          currentChapter: progress.currentChapter,
          retryCount: progress.retryCount,
          confidence: progress.confidence,
        });
        lastStage = progress.stage;
        lastRunning = progress.running;
      }

      if (progress.stage === "manual_review") {
        const manualReviewResult = await ensureManualReviewResolved(progress, evaluated);
        if (manualReviewResult.handled) {
          await sleep(2000);
          continue;
        }
        if (manualReviewResult.shouldStop) {
          await log("error", `第 ${progress.currentChapter} 章人工审阅无法自动处理，监控停止`, {
            chapterNo: progress.currentChapter,
            manualReview: manualReviewResult.manualReview ?? null,
            decision: manualReviewResult.decision ?? null,
            evaluatedChapters: [...evaluated].sort((left, right) => left - right),
            reportPath: REPORT_PATH,
          });
          return;
        }
      } else if (!progress.running && progress.currentChapter <= TARGET_CHAPTERS) {
        const now = Date.now();
        if (now - lastResumeAt > 30000) {
          try {
            await resumeRun();
            lastResumeAt = now;
            await log("warning", `检测到任务未运行，已尝试 resume（当前章 ${progress.currentChapter}）`);
          } catch (error) {
            await log("warning", "自动 resume 失败，将继续监控", {
              stage: progress.stage,
              currentChapter: progress.currentChapter,
              error: trimErrorMessage(error instanceof Error ? error.message : error),
            });
          }
        }
      }

      const latestProject = await getProject();
      if (!latestProject || typeof latestProject !== "object") {
        throw new Error("monitor_project_response_invalid");
      }
      if (ATTACH_ONLY && !attachHistorySeeded) {
        const skippedHistoricalChapters = getAttachModeSkippedChapters(
          latestProject,
          TARGET_CHAPTERS,
          progress.currentChapter,
        );
        for (const chapterNo of skippedHistoricalChapters) {
          evaluated.add(chapterNo);
        }
        attachHistorySeeded = true;
        if (skippedHistoricalChapters.length > 0) {
          await log("info", "附着监控已跳过历史章节回填，优先盯住最近章节", {
            currentChapter: progress.currentChapter,
            skippedCount: skippedHistoricalChapters.length,
            latestCompletedChapter: Math.max(0, Number(progress.currentChapter ?? 0) - 1),
          });
        }
      }
      const candidateChapters = getMonitorCandidateChapters(latestProject, TARGET_CHAPTERS);

      for (const chapterNo of candidateChapters) {
        if (evaluated.has(chapterNo)) {
          continue;
        }

        try {
          const chapterPayload = await getChapter(chapterNo);
          if (!chapterPayload?.content) {
            continue;
          }

          if (chapterNo >= TARGET_CHAPTERS) {
            try {
              await pauseRun();
            } catch {
              // Ignore pause failures here; we still want the evaluation result.
            }
          }

          const { evaluation, plannerQuality, localFlavorSignals } = await evaluateChapter(evaluatorProfile, latestProject, chapterNo, chapterPayload);
          const charterSignals = collectMonitorCharterSignals(latestProject, chapterPayload);
          evaluated.add(chapterNo);
          await log("info", `第 ${chapterNo} 章第三方评估完成`, {
            chapterNo,
            evaluation,
            charterSignals,
            plannerQuality,
            localFlavorSignals,
          });

          if (chapterNo >= TARGET_CHAPTERS) {
            try {
              await pauseRun();
            } catch {
              // Ignore pause failures at shutdown; the run loop may already be idle.
            }
            await log("info", `已完成前 ${TARGET_CHAPTERS} 章写作与监控，任务结束`, {
              evaluatedChapters: [...evaluated],
              reportPath: REPORT_PATH,
            });
            return;
          }
        } catch (error) {
          await log("warning", `第 ${chapterNo} 章监控评估失败，后续将继续重试`, {
            chapterNo,
            phase: "chapter_monitoring",
            error: trimErrorMessage(error instanceof Error ? error.message : error),
          });
        }
      }
    } catch (error) {
      if (!shouldRetryMonitorLoopError(error)) {
        throw error;
      }
      await log("warning", "监控轮询遇到瞬时异常，将继续重试", {
        error: trimErrorMessage(error instanceof Error ? error.message : error),
      });
    }

    await sleep(POLL_MS);
  }
}

const isDirectRun = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isDirectRun) {
  main().catch(async (error) => {
    const message = trimErrorMessage(error instanceof Error ? error.message : error);
    console.error(message);
    try {
      await log("error", "测试脚本异常退出", { error: message });
    } catch {
      // Ignore nested logging errors.
    }
    process.exitCode = 1;
  });
}
