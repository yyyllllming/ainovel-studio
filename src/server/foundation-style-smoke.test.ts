import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createProject } from "./repositories/project.repository.ts";
import { rawDb } from "./db/client.ts";
import { PROJECT_PURGE_TABLES } from "./project-trash.ts";
import {
  applyFoundationStyleSnapshot,
  createFoundationStyleSnapshot,
  importFoundationStyleReference,
  listFoundationStyleImports,
  listFoundationStyleSnapshots,
} from "./style/foundation-style.ts";
import { getFoundation, getFoundationWorkshopState } from "./repositories/foundation.repository.ts";
import { projectDir, withinProject } from "./paths.ts";
import { buildStylePromptBundle } from "./writing/style-prompt-guard.ts";
import { getActiveStylePackage } from "./repositories/style.repository.ts";
import type { ChatMessage } from "./llm.ts";

function buildImportText(title: string) {
  const districts = ["潮汐坊", "旧灯巷", "听雨埠", "白石渡", "栖钟台", "斜桥市"];
  const relics = ["骨哨", "盐铁牌", "潮纹匣", "旧铜钥", "裂镜片", "乌木签"];

  return Array.from({ length: 88 }, (_, index) => `第${index + 1}章 风起

${title}沿着潮湿石阶往上走，雾气顺着衣摆往膝骨里钻，像旧事一点点往身上爬。他没有停，只是把呼吸压得更轻，免得让身后的铜铃先听见他的犹豫。第${index + 1}夜的风从${districts[index % districts.length]}倒灌下来，把他袖口里那枚${relics[index % relics.length]}碰得发凉。

“再往前一步，夜禁就不是规矩，是收尸。”另一人把灯举高，影子一晃，声音也跟着发冷。${title}没有回头，只把指节在刀柄上扣紧：“要命也得去。”他记得昨夜在${districts[(index + 1) % districts.length]}听见的那句密语，还像鱼刺一样卡在喉咙里。

山口忽然炸开一串铁器碰撞声，巡夜人从暗处扑出，刀背劈在石栏上，火星和雨点一起乱溅。${title}侧身撞进风里，肩骨发麻，脚下一滑，整个人几乎翻出山道。那串动静把藏在他怀里的${relics[(index + 2) % relics.length]}也震得轻响，像在提醒他这一步已经回不了头。

那一下失重让他的心口空了一瞬，恐惧像冰水灌进肺里，可他在发抖里偏偏想起更久以前那句没说完的话。远处铜铃又响了一下，像有人把更大的麻烦摇给他听。第${index + 1}章的尾声里，他忽然意识到，真正盯上他的并不是夜禁，而是${districts[(index + 3) % districts.length]}那边迟迟没有熄灭的一盏灯。`).join("\n\n");
}

async function fakeStyleLlm(messages: ChatMessage[]) {
  const systemPrompt = messages[0]?.content ?? "";

  if (systemPrompt.includes("资深文学编辑")) {
    return JSON.stringify({
      narrativeDistance: "贴近人物即时感受，少做高空解释。",
      infoDelivery: "信息顺着动作和对白自然露出，不用旁白抢先解释。",
      paragraphRhythm: "叙述与对白交替，关键动作和情绪点用短段收紧。",
      dialogueBreathing: "对白保留气口和关系压强，不把结论说透。",
      emotionRendering: "情绪更多落在身体反应和环境回声里。",
      chapterClosure: "章末留后患，不做总结回钉。",
      forbiddenPatterns: ["解释腔", "平均句式", "空转比喻"],
      signature: "冷压强、动作牵引、留白收束",
    });
  }

  return JSON.stringify({
    referenceAnchor: {
      primary: "测试参考",
      secondary: ["辅参考 A"],
    },
    paragraphCadence: {
      narrativeRule: "叙述段以动作、感受和局势变化成组推进。",
      dialogueRule: "对白随气口、停顿和动作切换换段。",
      emphasisRule: "只在揭示或骤变处留短段。",
    },
    sentenceRhythm: {
      pacingRule: "长短句交替，避免平均句式。",
      transitionRule: "转场靠动作、视线和结果带动。",
      pauseRule: "停顿落在呼吸、手势和环境反馈上。",
    },
    narrativeDistance: {
      intimacyRule: "始终贴近当前人物的即时感受。",
      expositionRule: "解释延后，不要抢在场景前面下定义。",
      textureRule: "正文质感保持冷静、压紧、带风险余波。",
    },
    dialogueStyle: {
      voiceRule: "对白克制但带刺，不直接说透结论。",
      subtextRule: "冲突要靠停顿、对位和动作回声显形。",
      distinctionRule: "让身份与关系决定人物说话方式。",
    },
    imageryRegister: {
      densityRule: "意象点到为止，只服务气压和触感。",
      textureRule: "修辞顺着场景和动作生长，不堆金句。",
      avoid: ["空泛抒情", "模板转折", "解释性总结"],
    },
    forbiddenLexicon: ["推进主线", "阻力", "信息投放"],
    toneGuardrails: ["不要写成策划稿。", "不要把心理总结直接端出来。"],
    openingStrategy: "从动作和场景直接切入，不用总结式开场。",
    infoRevealRule: "关键信息顺着局势与对白自然露出。",
    emotionRenderingRule: "情绪依靠身体反应和环境反射外化。",
    chapterClosureRule: "章末只钉一个新后患，不回钉总结。",
    aiSmellPatterns: ["解释过早", "句式平均"],
    styleTaboos: ["空转比喻", "总结腔"],
  });
}

function cleanupProject(projectId: string) {
  rawDb.transaction(() => {
    for (const table of PROJECT_PURGE_TABLES) {
      rawDb.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(projectId);
    }
    rawDb.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  })();
}

test("foundation style smoke closes the import -> snapshot -> apply loop without UI", async () => {
  const project = createProject({
    title: "Style Smoke",
    genre: "悬疑",
    style: "冷峻",
    seriesMode: "standalone",
    storyLength: "long",
    narrativePerson: "third",
    chapterPlanningMode: "fixed",
    paceProfile: "medium",
    completionCriteria: "主线闭环",
    targetChapters: 12,
    premise: "主角必须违反夜禁去追一条旧线索。",
    assignments: [
      { role: "coauthor", profileId: "test-profile", model: "fake-model", temperature: 0.6, maxTokens: 4000 },
      { role: "planner", profileId: "test-profile", model: "fake-model", temperature: 0.4, maxTokens: 4000 },
      { role: "writer", profileId: "test-profile", model: "fake-model", temperature: 0.7, maxTokens: 4000 },
      { role: "reviewer", profileId: "test-profile", model: "fake-model", temperature: 0.2, maxTokens: 4000 },
    ],
  });

  const projectId = project?.id;
  assert.equal(Boolean(projectId), true);

  try {
    const imported = await importFoundationStyleReference(projectId!, {
      fileName: "style-source.txt",
      mediaType: "text/plain",
      title: "长夜潮声",
      author: "沈知白",
      buffer: Buffer.from(buildImportText("林霁"), "utf8"),
    });
    if (!imported) {
      throw new Error("style import 应返回导入记录");
    }

    assert.equal(listFoundationStyleImports(projectId!).length, 1);
    assert.equal(existsSync(imported.rawFilePath), true);
    assert.equal(existsSync(imported.normalizedFilePath), true);

    const snapshot = await createFoundationStyleSnapshot(
      projectId!,
      {
        mode: "book",
        sourceIds: [imported.id],
      },
      { llmCall: fakeStyleLlm },
    );

    assert.equal(listFoundationStyleSnapshots(projectId!).length, 1);
    assert.equal(snapshot.styleDigest.length >= 1_200, true);

    const applied = await applyFoundationStyleSnapshot(projectId!, snapshot.id);
    const foundation = getFoundation(projectId!);
    const workshop = getFoundationWorkshopState(projectId!);
    const activeStyle = getActiveStylePackage(projectId!);
    if (!workshop) {
      throw new Error("style apply 后应能读取 workshop state");
    }

    assert.equal(applied.snapshot.id, snapshot.id);
    assert.equal(foundation?.styleSnapshotId, snapshot.id);
    assert.equal(foundation?.styleSnapshotVersion, snapshot.version);
    assert.equal(workshop.draft.styleSnapshotId, snapshot.id);
    assert.equal((workshop.draft.styleDigest?.length ?? 0) > 0, true);
    assert.equal(activeStyle.styleSnapshotId, snapshot.id);
    assert.equal(activeStyle.styleDigest.length >= 1_200, true);
    assert.equal(activeStyle.sampledExcerpts.length > activeStyle.styleExemplars.length, true);
    assert.equal(existsSync(withinProject(projectId!, "config", "style-digest.md")), true);
    assert.equal(existsSync(withinProject(projectId!, "config", "style-exemplars.json")), true);

    rawDb.prepare("UPDATE foundations SET style_card = '', style_profile_json = '{}', style_digest = '' WHERE project_id = ?").run(projectId!);
    rawDb.prepare("UPDATE foundation_workshop_states SET draft_json = ? WHERE project_id = ?").run(
      JSON.stringify({
        ...workshop.draft,
        styleSteeringCard: "",
        styleProfile: {},
        styleDigest: "",
      }),
      projectId!,
    );
    const snapshotBackedStyle = getActiveStylePackage(projectId!);
    assert.equal(snapshotBackedStyle.styleSnapshotId, snapshot.id);
    assert.equal(snapshotBackedStyle.styleCard, snapshot.styleCard);
    assert.equal(snapshotBackedStyle.styleDigest.length >= 1_200, true);

    const writerBundle = buildStylePromptBundle("writer", activeStyle);
    const exemplarIds = new Set(activeStyle.styleExemplars.map((entry) => entry.id));
    const nonExemplarExcerpt = activeStyle.sampledExcerpts.find((entry) => !exemplarIds.has(entry.id));
    assert.match(writerBundle.sections.join("\n\n"), /风格摘要/);
    assert.equal(Boolean(nonExemplarExcerpt), true);
    assert.equal(
      writerBundle.sections.join("\n\n").includes(nonExemplarExcerpt!.content.trim()),
      false,
    );
  } finally {
    cleanupProject(projectId!);
    await rm(projectDir(projectId!), { recursive: true, force: true });
  }
});
