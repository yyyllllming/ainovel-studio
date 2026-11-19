import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appPaths, projectDir, withinProject } from "./paths.ts";

const TARGET_CHAPTER = 7;

const seedProfile = {
  id: "profile-smoke",
  name: "Smoke Relay",
  providerId: "custom",
  protocol: "openai_compatible" as const,
  baseUrl: "https://relay.example.com/v1",
  apiKey: "sk-smoke-secret",
  defaultModel: "smoke-model",
  enabled: true,
  createdAt: "2026-04-02T00:00:00.000Z",
  updatedAt: "2026-04-02T00:00:00.000Z",
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(assertion: () => boolean, timeoutMs = 10_000) {
  const startedAt = Date.now();
  while (!assertion()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("waitFor timeout");
    }
    await sleep(50);
  }
}

function createBlueprint() {
  return {
    reason: "smoke blueprint",
    blueprint: {
      chapterNo: TARGET_CHAPTER,
      sceneGoal: "让林雾在旧灯埠借一份被封存的巡港账册确认雾潮的来路，并因此暴露自己仍在追查封潮仓。",
      characters: ["林雾", "周戍"],
      locations: ["旧灯埠", "封潮仓"],
      conflicts: [
        "林雾必须在巡夜人换岗前拿到账册，否则周戍会被迫替她扛下追查痕迹。",
        "一旦封潮仓里的旧铃再次响起，码头上的人就会顺着声源找到她藏身的走道。",
      ],
      foreshadows: ["账册里那枚缺角印记会把下一章的目标直接推向封潮仓最深处。"],
      emotionalTone: "压低声势，逐步绷紧",
      estimatedWords: 2800,
      requiredProgressDelta: "information_shift",
    },
  };
}

function createQuickAuditResponse() {
  return {
    verdict: "pass" as const,
    confidence: 0.91,
    reason: "极简检查通过",
    fixInstructions: "无需额外修改",
    issues: [],
    triggerReasons: ["final_chapter"],
    styleChecklistHits: [],
    charterViolations: [],
    storyProgression: {
      risk: "pass" as const,
      score: 88,
      summary: "主推进已经落地。",
      advancements: ["账册线索坐实", "下一章目标被钉住"],
      stallSignals: [],
      primaryDelta: "information_shift" as const,
      deliveredDeltas: ["information_shift"],
    },
    genreFulfillment: {
      risk: "pass" as const,
      score: 85,
      summary: "当前章完成了核心题材义务。",
      present: ["线索推进"],
      missing: [],
      activePacks: ["core-only" as const],
    },
    loopRisk: {
      risk: "pass" as const,
      score: 93,
      summary: "没有检测到循环风险。",
      repetitionAxes: [],
      stuckDimensions: [],
    },
    primaryDeltaDelivered: "information_shift" as const,
    stuckDimensions: [],
  };
}

function createDeepReviewResponse() {
  return {
    verdict: "pass" as const,
    confidence: 0.92,
    reason: "深审通过，当前章可以定稿。",
    fixInstructions: "无需额外修改",
    issues: [],
    triggerReasons: ["final_chapter"],
    styleChecklistHits: [],
    charterViolations: [],
    storyProgression: {
      risk: "pass" as const,
      score: 90,
      summary: "章节推进稳定。",
      advancements: ["账册线索坐实", "人物选择产生代价"],
      stallSignals: [],
      primaryDelta: "information_shift" as const,
      deliveredDeltas: ["information_shift"],
    },
    genreFulfillment: {
      risk: "pass" as const,
      score: 86,
      summary: "题材履约稳定。",
      present: ["主线推进"],
      missing: [],
      activePacks: ["core-only" as const],
    },
    loopRisk: {
      risk: "pass" as const,
      score: 95,
      summary: "没有循环风险。",
      repetitionAxes: [],
      stuckDimensions: [],
    },
    primaryDeltaDelivered: "information_shift" as const,
    stuckDimensions: [],
    windowStartChapter: TARGET_CHAPTER,
    windowEndChapter: TARGET_CHAPTER,
    earliestAffectedChapter: TARGET_CHAPTER,
  };
}

function buildChapterText(tag: string) {
  return [
    `暮色压进旧灯埠的时候，林雾贴着潮湿木桩往里走，脚底的水迹一路拖到废弃货棚边。${tag} 她没有点灯，只借河面碎开的反光辨认封条的裂口，先把巡港账册从木匣里拖出来，再把袖里那枚缺角印记按在封蜡上试了一次。印痕对得极准，说明封潮仓和这一页旧账本来就属于同一套锁链，今晚若错过这次缝隙，下一回就只能正面撞上换岗的巡夜人。`,
    `另一头的栈桥传来短促铃声，周戍立刻从黑影里抬手，示意巡夜队已经折回。林雾没有把账册整本带走，只在最要紧的几页上迅速记下船名、潮位和仓号，再把散开的纸角重新压平。这样做会慢一点，却能把破绽留到最小；周戍替她守在外沿，手里拎着湿麻绳，像随时准备把追过来的人引去另一条废水道。`,
    `风从封潮仓方向灌过来时，账页间那股发霉的药灰味忽然重了，林雾低头一看，才发现有一行记录被人用极薄的灰墨改过，原先写着“退仓”，后来被改成“回仓”。她顺着那一点改痕往下追，终于在页脚看见和袖中印记同源的仓印。账册没有告诉她仓里藏着什么，却把下一步逼得极清楚：真正的源头不在码头表面，而在封潮仓最深处那间从不对外启封的旧检验室。`,
    `周戍听完她压低声音念出的仓号，只说了一句“那地方白天也没人敢久站”，便把湿麻绳缠回腕上，转身替她清掉脚边的鞋印。林雾把账册放回原处，掌心却一直扣着那枚缺角印记，没有半点松开。她知道自己已经把路走窄了；等明天潮水一退，巡夜人会先发现封蜡被动过，而她只能比他们更早一步进到封潮仓深处，把那间旧检验室真正撬开。`,
  ].join("\n\n");
}

function buildRecoveryChapterText() {
  return [
    buildChapterText("recovery"),
    "检验室外墙的盐灰被潮气泡得发胀，林雾抬手摸过砖缝，指腹立刻沾上一层细白的粉。那不是普通海盐，更像是旧时代拿来封样的药灰，时间一久，气味会沉进木梁里，潮一回来便重新浮上来。周戍站在廊角替她望风，没有催她，只把巡夜铃重新数了一遍，低声提醒她下一轮换岗会更近，留给他们试门的时间只够一次。",
    "她把缺角仓印压进门侧的铜槽，先听见里面极轻的一声咬合，随后整块铁面像被某种迟缓的力从内部顶开一线。缝里没有风，只有久封不散的霉味和更深处的一点冷金属气。林雾没有立刻把门推大，而是借那道窄缝往里看，看到地上并排摆着三只旧样箱，最里一只箱盖半掩，箱角印着和账册页脚完全一致的仓号。那一瞬她反而更冷静，知道今晚真正要找的不是某件遗物，而是一份足够让整套巡港说辞失效的原始检验记录。",
    "周戍听见门内铁面轻响，立刻把身子挪到走道正中，替她挡住外面可能照进来的灯。林雾顺势把记下的仓号和潮位重新过了一遍，终于把账册、仓印和旧检验室连成了一条能自洽的线：有人先在账册里改动退仓记录，再把真正的样箱锁回检验室深处，靠巡夜制度一次次拖延启封时间。等天亮以后，沈檀若发现这条线已经被她摸到，下一步就不会只停在封仓，而是会直接灭掉剩下的证据。",
    "走道尽头忽然传来木板被水顶起的闷响，像有人在下面缓慢翻身。林雾没有被那声音推乱，她先把样箱上留下的仓号与账册的页码对应起来，再把最关键的两处改动记到掌心，确认自己即使来不及把箱子带走，也已经拿到足够继续追下去的硬证据。周戍看见她抬头，便明白里面确实藏着比账册更深的东西，于是反手把外门虚掩，让整条走道重新吞回黑暗。",
    "临走前，林雾又朝检验室里看了一眼。最深处那面潮斑剥落的墙上并没有挂钥匙，只有一道被反复擦拭过的窄痕，长度刚好能容下一枚细长铜签。她把这处细节牢牢记住，没有伸手去碰，因为她知道真正危险的部分往往不是眼前摆着的箱子，而是有人专门留下、等后来者自投罗网的第二道门。等潮水再退一寸，她就要带着新的路线回到这里，把那道门后面没来得及清掉的东西一并挖出来。",
  ].join("\n\n");
}

function splitIntoThree(input: string) {
  const first = Math.floor(input.length * 0.34);
  const second = Math.floor(input.length * 0.68);
  return [
    input.slice(0, first),
    input.slice(first, second),
    input.slice(second),
  ];
}

function splitForCheckpointRecovery(input: string) {
  const firstCut = Math.min(Math.max(720, Math.floor(input.length * 0.42)), input.length - 320);
  const secondCut = Math.min(Math.max(1200, Math.floor(input.length * 0.78)), input.length - 120);

  return [
    input.slice(0, firstCut),
    input.slice(firstCut, secondCut),
    input.slice(secondCut),
  ];
}

function createStreamResponse(
  chunks: string[],
  input?: {
    delayMs?: number;
    crashAfterChunks?: boolean;
  },
) {
  const encoder = new TextEncoder();
  const delayMs = input?.delayMs ?? 0;

  return new Response(
    new ReadableStream({
      async start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`),
          );
          if (delayMs > 0) {
            await sleep(delayMs);
          }
        }

        if (input?.crashAfterChunks) {
          controller.error(new Error("simulated writer crash"));
          return;
        }

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
      },
    },
  );
}

function installFetchStub(streamFactory: () => Response) {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(String(init?.body ?? "{}")) as {
      stream?: boolean;
      messages?: Array<{ role?: string; content?: string }>;
    };
    const systemPrompt = payload.messages?.[0]?.content ?? "";

    if (payload.stream) {
      return streamFactory();
    }
    if (systemPrompt.includes("你是小说主笔 Writer。")) {
      // Non-streaming Writer calls: auto prose-rescue / review rewrite / style rescue.
      // Echo back the chapter text supplied in the prompt so the rescue/rewrite loop
      // converges instead of throwing "unexpected llm call" and failing the run.
      const messages = payload.messages ?? [];
      const userPrompt = messages[messages.length - 1]?.content ?? "";
      const marker = "当前正文：\n";
      const markerIndex = userPrompt.lastIndexOf(marker);
      const echoedChapter = markerIndex >= 0 ? userPrompt.slice(markerIndex + marker.length).trim() : "";
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: echoedChapter,
              },
              finish_reason: "stop",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (systemPrompt.includes("负责当前章的内部剧情规划")) {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify(createBlueprint()),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (systemPrompt.includes("极简检查 AI")) {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify(createQuickAuditResponse()),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (systemPrompt.includes("长篇连续性深审 AI")) {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify(createDeepReviewResponse()),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    throw new Error(`unexpected llm call: ${systemPrompt.slice(0, 80)}`);
  };

  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("runDetachedExecution smoke covers commit, pause/resume, and checkpoint recovery", async (t) => {
  const originalPaths = {
    configDir: appPaths.configDir,
    profileFile: appPaths.profileFile,
    profileExampleFile: appPaths.profileExampleFile,
    projectsDir: appPaths.projectsDir,
    ideasDir: appPaths.ideasDir,
    authorsDir: appPaths.authorsDir,
    dataDir: appPaths.dataDir,
    dbFile: appPaths.dbFile,
  };
  const originalDisableWorkers = process.env.AINOVEL_DISABLE_DETACHED_WORKERS;
  const tempRoot = await mkdtemp(join(tmpdir(), "ainovel-run-manager-smoke-"));

  appPaths.configDir = join(tempRoot, "config");
  appPaths.profileFile = join(tempRoot, "config", "llm-profiles.json");
  appPaths.profileExampleFile = join(tempRoot, "config", "llm-profiles.example.json");
  appPaths.projectsDir = join(tempRoot, "projects");
  appPaths.ideasDir = join(tempRoot, "ideas");
  appPaths.authorsDir = join(tempRoot, "authors");
  appPaths.dataDir = join(tempRoot, "data");
  appPaths.dbFile = join(tempRoot, "data", "app.test.db");
  process.env.AINOVEL_DISABLE_DETACHED_WORKERS = "1";

  await mkdir(appPaths.configDir, { recursive: true });
  await writeFile(
    appPaths.profileFile,
    JSON.stringify(
      {
        version: 1,
        profiles: [seedProfile],
      },
      null,
      2,
    ),
    "utf8",
  );

  const { createProject } = await import("./repositories/project.repository.ts");
  const { saveFoundation, lockFoundation } = await import("./repositories/foundation.repository.ts");
  const { getRunState, listRunLogs } = await import("./repositories/run.repository.ts");
  const {
    readFinalChapter,
    replaceCanonFactEntriesForChapter,
    saveSummaryFiles,
    writeCharacterSnapshot,
    writeFinalChapter,
    writeLogicStateSnapshot,
  } = await import("./project-files.ts");
  const { pauseRun, runDetachedExecution } = await import("./run-manager.ts");
  const { rawDb } = await import("./db/client.ts");
  const { PROJECT_PURGE_TABLES } = await import("./project-trash.ts");

  function cleanupProject(projectId: string) {
    rawDb.transaction(() => {
      for (const table of PROJECT_PURGE_TABLES) {
        rawDb.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(projectId);
      }
      rawDb.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
    })();
  }

  async function destroyProject(projectId: string) {
    await rm(projectDir(projectId), { recursive: true, force: true });
    cleanupProject(projectId);
  }

  async function createLockedProject(title: string) {
    const canonicalFoundation = {
      premise: "雾港每逢退潮都会露出旧年代留下的封仓编号，林雾要在巡夜制度内找到被掩埋的真相。",
      mainline: "林雾要借巡夜换岗的缝隙查清封潮仓里的删改记录，并把线索一路追进旧检验室。",
      storyHook: "开篇林雾潜入旧灯埠盗看巡港账册，刚确认缺角仓印与封潮仓同源，巡夜铃就逼近了。",
      styleCard: "冷静、克制、靠动作与细节推进悬念。",
      characters: [
        { name: "林雾", role: "查账人", goal: "找到封潮仓里被删改的巡港记录", traits: ["谨慎", "能忍", "记性极强"] },
        { name: "周戍", role: "前巡夜人", goal: "替林雾挡住码头上的明面搜查", traits: ["沉稳", "护短", "熟悉码头"] },
        { name: "沈檀", role: "仓务总管", goal: "掩住旧仓真正的启封原因", traits: ["精明", "狠辣", "不露声色"] },
      ],
      worldview: [
        { name: "旧灯埠", description: "废弃码头，潮水退尽时会露出旧巡港编号。" },
        { name: "封潮仓", description: "码头最深处的旧仓，存放被封存的巡港账册。" },
        { name: "巡夜换岗", description: "每隔一刻换岗一次，铃声会先于人影抵达。" },
        { name: "缺角仓印", description: "只有旧检验室流出的印记才能打开被灰墨改写的账页。" },
      ],
      relationships: [
        { source: "林雾", target: "周戍", label: "互相掩护但都保留后手" },
        { source: "林雾", target: "沈檀", label: "暗中对查与反查" },
      ],
    };

    const project = createProject({
      title,
      genre: "悬疑",
      style: "default",
      seriesMode: "standalone",
      storyLength: "long",
      narrativePerson: "third",
      chapterPlanningMode: "fixed",
      paceProfile: "medium",
      completionCriteria: "主线闭环",
      chapterBudgetMin: TARGET_CHAPTER,
      chapterBudgetTarget: TARGET_CHAPTER,
      chapterBudgetMax: TARGET_CHAPTER,
      hardChapterCap: TARGET_CHAPTER,
      targetChapters: TARGET_CHAPTER,
      premise: "主角必须在雾港的旧码头里查出被掩埋的巡港真相。",
      reviewPolicy: {
        cadenceChapters: 99,
        deepReviewStartChapter: 99,
        forceTriggers: ["final_chapter"],
        manualCheckpointChapters: [],
      },
      assignments: [
        { role: "coauthor", profileId: seedProfile.id, model: seedProfile.defaultModel, temperature: 0.6, maxTokens: 4096 },
        { role: "planner", profileId: seedProfile.id, model: seedProfile.defaultModel, temperature: 0.4, maxTokens: 4096 },
        { role: "writer", profileId: seedProfile.id, model: seedProfile.defaultModel, temperature: 0.7, maxTokens: 8192 },
        { role: "reviewer", profileId: seedProfile.id, model: seedProfile.defaultModel, temperature: 0.2, maxTokens: 4096 },
      ],
      workshopSeed: {
        draft: {
          premise: canonicalFoundation.premise,
          mainline: canonicalFoundation.mainline,
          storyHook: canonicalFoundation.storyHook,
          desiredTone: "default",
          characterIdeas: canonicalFoundation.characters,
          worldviewIdeas: canonicalFoundation.worldview,
          relationshipIdeas: canonicalFoundation.relationships,
          unresolvedQuestions: [],
          styleReferences: [],
          styleSamples: [],
          styleManualGuidance: "",
          styleAvoidances: "",
          styleSteeringCard: canonicalFoundation.styleCard,
          styleProfile: undefined,
          styleSnapshotId: null,
          styleSnapshotVersion: null,
          styleDigest: "",
          styleExemplars: [],
        },
        messages: [],
      },
    });

    if (!project?.id) {
      throw new Error("failed to create smoke test project");
    }

    saveFoundation(project.id, canonicalFoundation);
    lockFoundation(project.id);

    for (let chapterNo = 1; chapterNo < TARGET_CHAPTER; chapterNo += 1) {
      await writeFinalChapter(project.id, chapterNo, `前情记录 ${chapterNo}。`);
      await saveSummaryFiles(project.id, chapterNo, {
        brief: `第 ${chapterNo} 章简要摘要`,
        detailed: `第 ${chapterNo} 章详细摘要`,
        full: `第 ${chapterNo} 章完整摘要`,
      });
      await writeCharacterSnapshot(project.id, chapterNo, { chapterNo, characters: {} });
      await replaceCanonFactEntriesForChapter(project.id, chapterNo, []);
      await writeLogicStateSnapshot(project.id, chapterNo, {
        chapterNo,
        relationshipDeltas: [],
        timeMarker: "",
        unresolvedPromises: [],
        pendingConsequences: [],
        hookDiagnostics: null,
      });
      await writeFile(
        withinProject(project.id, "canon", `artifact_status_${String(chapterNo).padStart(3, "0")}.json`),
        JSON.stringify({
          usedFallback: false,
          aggregateStatus: "success",
          components: { summaries: "success", facts: "success", snapshot: "success" },
          factCount: 0,
          snapshotCharacterCount: 0,
          missingCategories: [],
        }),
        "utf8",
      );
    }

    return project.id;
  }

  try {
    await t.test("single chapter run reaches committed completion", async () => {
      const projectId = await createLockedProject("Smoke Commit");
      const chapterText = buildChapterText("commit");
      const restoreFetch = installFetchStub(() => createStreamResponse(splitIntoThree(chapterText)));

      try {
        await runDetachedExecution(projectId, {
          sessionId: "session-commit",
          fromChapter: TARGET_CHAPTER,
        });

        const runState = getRunState(projectId);
        const finalChapter = await readFinalChapter(projectId, TARGET_CHAPTER);
        const commitRow = rawDb.prepare(`
          SELECT state
          FROM chapter_commits
          WHERE project_id = ?
          ORDER BY updated_at DESC
          LIMIT 1
        `).get(projectId) as { state: string } | undefined;

        assert.equal(runState?.stage, "completed");
        assert.equal(runState?.currentChapter, TARGET_CHAPTER);
        assert.equal(commitRow?.state, "committed");
        assert.equal(finalChapter?.includes("封潮仓最深处"), true);
        assert.deepEqual(
          rawDb.prepare("SELECT COUNT(*) AS count FROM artifact_outbox WHERE project_id = ?").get(projectId) as { count: number },
          { count: 1 },
        );
      } finally {
        restoreFetch();
        await destroyProject(projectId);
      }
    });

    await t.test("pauseRun suspends the detached run gracefully and a rerun resumes it", async () => {
      const projectId = await createLockedProject("Smoke Pause Resume");
      const chapterText = buildChapterText("pause");
      const restoreFetch = installFetchStub(() =>
        createStreamResponse(splitIntoThree(chapterText), {
          delayMs: 180,
        }),
      );

      try {
        const runPromise = runDetachedExecution(projectId, {
          sessionId: "session-pause",
          fromChapter: TARGET_CHAPTER,
        });

        await waitFor(() => (getRunState(projectId)?.wordCount ?? 0) > 300);
        pauseRun(projectId);

        // The detached runner must exit through the graceful suspension path
        // instead of blocking in-process forever (legacy resumeRun is gone): a paused
        // process that never exits would race the next runner spawned on resume.
        await runPromise;

        const pausedState = getRunState(projectId);
        const pausedLogs = listRunLogs(projectId);
        assert.equal(pausedState?.stage, "paused");
        assert.equal(pausedState?.currentChapter, TARGET_CHAPTER);
        assert.equal(pausedLogs.some((entry) => entry.message.includes("任务已暂停")), true);
        assert.equal(pausedLogs.some((entry) => entry.message.includes("自动写作已暂停")), true);
      } finally {
        restoreFetch();
      }

      const restoreResumeFetch = installFetchStub(() =>
        createStreamResponse(["\n\n夜潮退尽前，林雾把巡港账册按原样放回木匣，才带着抄好的仓号退出旧灯埠。"]),
      );

      try {
        // Resume the same project through a fresh detached execution, mirroring how the
        // orchestrator relaunches a paused session from run_sessions.current_chapter.
        await runDetachedExecution(projectId, {
          sessionId: "session-pause-resume",
          fromChapter: TARGET_CHAPTER,
        });

        const runState = getRunState(projectId);
        const logs = listRunLogs(projectId);
        const finalChapter = await readFinalChapter(projectId, TARGET_CHAPTER);

        assert.equal(runState?.stage, "completed");
        // 暂停只在阶段边界生效，流式写作会把整章写完（含 DRAFT_END）。恢复时
        // 完整草稿走"直接复用成稿"，中断草稿走"恢复续写"——两者都不允许从零重写。
        assert.equal(
          logs.some((entry) => entry.message.includes("恢复续写") || entry.message.includes("直接复用成稿")),
          true,
        );
        assert.equal(finalChapter?.includes("周戍"), true);
      } finally {
        restoreResumeFetch();
        await destroyProject(projectId);
      }
    });

    await t.test("rerun resumes from checkpoint after a writer crash", async () => {
      const projectId = await createLockedProject("Smoke Checkpoint Recovery");
      const chapterText = buildRecoveryChapterText();
      const [firstChunk, secondChunk, thirdChunk] = splitForCheckpointRecovery(chapterText);
      const restoreCrashFetch = installFetchStub(() =>
        createStreamResponse([firstChunk, secondChunk], {
          delayMs: 20,
          crashAfterChunks: true,
        }),
      );

      try {
        await runDetachedExecution(projectId, {
          sessionId: "session-crash-1",
          fromChapter: TARGET_CHAPTER,
        });

        const failedState = getRunState(projectId);
        const checkpointDir = withinProject(projectId, "drafts", ".checkpoints");
        const checkpoints = existsSync(checkpointDir) ? await readdir(checkpointDir) : [];

        assert.equal(failedState?.stage, "failed");
        assert.equal(checkpoints.length > 0, true);
        assert.equal(
          (failedState?.currentPosition ?? 0) > 0,
          true,
          `失败状态丢失写作位置：${JSON.stringify(failedState)}`,
        );
        assert.equal(Boolean(failedState?.draftFile), true, `失败状态丢失草稿路径：${JSON.stringify(failedState)}`);
      } finally {
        restoreCrashFetch();
      }

      const restoreRecoveryFetch = installFetchStub(() => createStreamResponse([thirdChunk]));

      try {
        await runDetachedExecution(projectId, {
          sessionId: "session-crash-2",
          fromChapter: TARGET_CHAPTER,
        });

        const runState = getRunState(projectId);
        const finalChapter = await readFinalChapter(projectId, TARGET_CHAPTER);
        const recoveryLogs = listRunLogs(projectId);

        assert.equal(runState?.stage, "completed");
        assert.equal(
          recoveryLogs.some((entry) => entry.message.includes("恢复续写") || entry.message.includes("直接复用成稿")),
          true,
          `没有命中恢复分支：${recoveryLogs.map((entry) => entry.message).join(" | ")}`,
        );
        const restoredDraftLog = recoveryLogs.find((entry) => entry.message.includes("从 draft 恢复续写"));
        const mergedWordCount = Math.max(
          ...recoveryLogs.map((entry) => Number(entry.message.match(/草稿生成完成（(\d+) 词）/)?.[1] ?? 0)),
        );
        assert.match(restoredDraftLog?.message ?? "", /已载入 \d+ 词/);
        assert.equal(mergedWordCount > thirdChunk.length + 500, true, "恢复稿与续写段未在审稿重写前完成合并");
        assert.equal(Boolean(finalChapter), true);
      } finally {
        restoreRecoveryFetch();
        await destroyProject(projectId);
      }
    });
  } finally {
    rawDb.close();
    delete (globalThis as { __ainovelDb?: unknown }).__ainovelDb;

    appPaths.configDir = originalPaths.configDir;
    appPaths.profileFile = originalPaths.profileFile;
    appPaths.profileExampleFile = originalPaths.profileExampleFile;
    appPaths.projectsDir = originalPaths.projectsDir;
    appPaths.ideasDir = originalPaths.ideasDir;
    appPaths.authorsDir = originalPaths.authorsDir;
    appPaths.dataDir = originalPaths.dataDir;
    appPaths.dbFile = originalPaths.dbFile;
    if (originalDisableWorkers === undefined) {
      delete process.env.AINOVEL_DISABLE_DETACHED_WORKERS;
    } else {
      process.env.AINOVEL_DISABLE_DETACHED_WORKERS = originalDisableWorkers;
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
});
