import test from "node:test";
import assert from "node:assert/strict";
import { prepareStyleReferenceImport } from "./style/style-reference-import.ts";
import { generateStyleCardSnapshot } from "./style/style-snapshot.ts";
import type { StyleReferenceImport } from "./types.ts";
import type { ChatMessage } from "./llm.ts";
import type { StyleFingerprint } from "./style-fingerprint.ts";

function buildReferenceChapter(index: number, name: string) {
  return `第${index}章 风起

${name}沿着潮湿石阶往上走，雾气顺着衣摆往膝骨里钻，像旧事一点点往身上爬。他没有停，只是把呼吸压得更轻，免得让身后的铜铃先听见他的犹豫。

“再往前一步，夜禁就不是规矩，是收尸。”另一人把灯举高，影子一晃，声音也跟着发冷。${name}没有回头，只把指节在刀柄上扣紧：“要命也得去。”

山口忽然炸开一串铁器碰撞声，巡夜人从暗处扑出，刀背劈在石栏上，火星和雨点一起乱溅。${name}侧身撞进风里，肩骨发麻，脚下一滑，整个人几乎翻出山道。

那一下失重让他的心口空了一瞬，恐惧像冰水灌进肺里，可他在发抖里偏偏想起更久以前那句没说完的话。远处铜铃又响了一下，像有人把更大的麻烦摇给他听。`;
}

function buildLargeReference(chapters: number, name: string) {
  return Array.from({ length: chapters }, (_, index) => buildReferenceChapter(index + 1, name)).join("\n\n");
}

function createImport(id: string, title: string, author: string, chapters: number): StyleReferenceImport & {
  normalizedText?: string;
  fingerprint?: StyleFingerprint;
} {
  const prepared = prepareStyleReferenceImport({
    buffer: Buffer.from(buildLargeReference(chapters, title.slice(0, 2)), "utf8"),
    fileName: `${title}.txt`,
    title,
    author,
  });

  return {
    id,
    projectId: "project-style-test",
    title: prepared.title,
    author: prepared.author,
    originalFileName: prepared.originalFileName,
    mediaType: prepared.mediaType,
    sourceHash: prepared.sourceHash,
    rawFilePath: `/tmp/${id}.txt`,
    normalizedFilePath: `/tmp/${id}.normalized.txt`,
    wordCount: prepared.wordCount,
    encoding: prepared.encoding,
    confidence: prepared.confidence,
    chapterCount: prepared.chapterCount,
    excerpts: prepared.excerpts.map((entry) => ({ ...entry, sourceId: id })),
    normalizedText: prepared.normalizedText,
    fingerprint: prepared.fingerprint,
    createdAt: "2026-03-24T00:00:00.000Z",
  };
}

function createShortImport(id: string, title: string, author: string): StyleReferenceImport & {
  normalizedText?: string;
  fingerprint?: StyleFingerprint;
} {
  const prepared = prepareStyleReferenceImport({
    buffer: Buffer.from(`本书来自青卷整理，请勿外传

最新网址：www.example.com

第1章 夜潮

裴照沿着潮湿的石阶上去，风从旧灯巷口卷回来，像有人把昨夜没说完的话塞进他领口。

“再往前，夜禁就不是规矩，是收尸。”守桥人抬灯挡住他。裴照没退，只把手按在刀鞘上：“那也得去。”

山口忽然炸开铁器碰撞声，巡夜人自暗处扑出，火星和雨点一道乱溅。

第2章 灯下

他闯进白石渡废屋时，梁上悬着一枚裂镜片，镜面里只照出半张脸。

“你终于还是来了。”屋里的人没有回头，声音压得很低，像怕惊醒别的东西。

裴照心口发紧，却先闻到木柜里渗出的潮腥味，那味道和三年前案发那夜一模一样。

第3章 回声

他想起旧案卷宗上那句被涂黑的话，忽然明白今晚真正盯上自己的不是巡夜司，而是更早以前那次灭口。

远处铜铃又响了一声，像有人把更大的麻烦摇给他听。`, "utf8"),
    fileName: `${title}.txt`,
    title,
    author,
  });

  return {
    id,
    projectId: "project-style-test",
    title: prepared.title,
    author: prepared.author,
    originalFileName: prepared.originalFileName,
    mediaType: prepared.mediaType,
    sourceHash: prepared.sourceHash,
    rawFilePath: `/tmp/${id}.txt`,
    normalizedFilePath: `/tmp/${id}.normalized.txt`,
    wordCount: prepared.wordCount,
    encoding: prepared.encoding,
    confidence: prepared.confidence,
    chapterCount: prepared.chapterCount,
    excerpts: prepared.excerpts.map((entry) => ({ ...entry, sourceId: id })),
    normalizedText: prepared.normalizedText,
    fingerprint: prepared.fingerprint,
    createdAt: "2026-03-24T00:00:00.000Z",
  };
}

function createMechanismImport(id: string, title: string, author: string): StyleReferenceImport & {
  normalizedText?: string;
  fingerprint?: StyleFingerprint;
} {
  const prepared = prepareStyleReferenceImport({
    buffer: Buffer.from(Array.from({ length: 36 }, (_, index) => `第${index + 1}章 灵痕

石缝里那道灵纹先是暗了一瞬，随即贴着岩皮慢慢游开，像有活物在石层底下换气。裴照没敢碰，只把掌心更轻地压上去，指骨立刻传来一阵细碎发麻，像有什么东西顺着血路往里试探。

他刚想收手，纹路又亮了一线，碎光沿着虎口一掠而过，随即熄了下去。那一下并没有给出答案，只留下更尖一点的刺痛和一缕并不属于他的冷气，像是某种门路刚露了个边。

“别再试。”守夜人只低低说了一句，灯火却跟着往后挪了半步。裴照没有应声，只盯着手背上那点很快淡下去的细痕，知道这东西已经记住了自己。`).join("\n\n"), "utf8"),
    fileName: `${title}.txt`,
    title,
    author,
  });

  return {
    id,
    projectId: "project-style-test",
    title: prepared.title,
    author: prepared.author,
    originalFileName: prepared.originalFileName,
    mediaType: prepared.mediaType,
    sourceHash: prepared.sourceHash,
    rawFilePath: `/tmp/${id}.txt`,
    normalizedFilePath: `/tmp/${id}.normalized.txt`,
    wordCount: prepared.wordCount,
    encoding: prepared.encoding,
    confidence: prepared.confidence,
    chapterCount: prepared.chapterCount,
    excerpts: prepared.excerpts.map((entry) => ({ ...entry, sourceId: id })),
    normalizedText: prepared.normalizedText,
    fingerprint: prepared.fingerprint,
    createdAt: "2026-03-24T00:00:00.000Z",
  };
}

function createSceneAwareImport(id: string, title: string, author: string): StyleReferenceImport & {
  normalizedText?: string;
  fingerprint?: StyleFingerprint;
} {
  const prepared = prepareStyleReferenceImport({
    buffer: Buffer.from(Array.from({ length: 40 }, (_, index) => `第${index + 1}章 风缝

他没有接话，只把沾血的手指慢慢蜷回袖里，盯着门槛边那道被雨水泡开的旧痕。屋里一时谁也没动，只有灯火在碗口里轻轻晃，像有一句更重的话压着不肯落地。

院门外的脚步声比先前更近了一层，先是两个人，后来像又添了第三个人。木门没有立刻被撞开，可门轴已经开始一下比一下更紧地呻吟，连窗纸上的影子都被逼得薄了一层。

远处忽然传来一声极轻的铜响，像是谁把下一场麻烦先挂到了风里。那声音只晃了一下就停，却让他知道今夜还远没收束。`).join("\n\n"), "utf8"),
    fileName: `${title}.txt`,
    title,
    author,
  });

  return {
    id,
    projectId: "project-style-test",
    title: prepared.title,
    author: prepared.author,
    originalFileName: prepared.originalFileName,
    mediaType: prepared.mediaType,
    sourceHash: prepared.sourceHash,
    rawFilePath: `/tmp/${id}.txt`,
    normalizedFilePath: `/tmp/${id}.normalized.txt`,
    wordCount: prepared.wordCount,
    encoding: prepared.encoding,
    confidence: prepared.confidence,
    chapterCount: prepared.chapterCount,
    excerpts: prepared.excerpts.map((entry) => ({ ...entry, sourceId: id })),
    normalizedText: prepared.normalizedText,
    fingerprint: prepared.fingerprint,
    createdAt: "2026-03-24T00:00:00.000Z",
  };
}

async function fakeStyleLlm(messages: ChatMessage[]) {
  const systemPrompt = messages[0]?.content ?? "";

  if (systemPrompt.includes("分析小说文本的写作风格")) {
    return JSON.stringify({
      narrativeDistance: "贴近人物即时感受，少做高空解释。",
      dialogueStyle: "对白有留白，靠关系压强和停顿传递冲突。",
      emotionMethod: "情绪多落在身体反应与环境反射上。",
      pacing: "叙述与对白交替，关键动作处用短段压紧。",
      distinctivePatterns: ["冷压强推进", "动作后果先行", "章末留余震"],
      antiPatterns: ["解释腔", "平均句式", "空转比喻"],
      rhetoricFingerprint: "显性比喻低频但命中冷硬物件，对比句和拟人化环境会反复回钉压迫感。",
      narrativeRhythmDNA: "张力整体递升，冲突前常用短句连发，段落呼吸偏紧。",
      emotionSpectrum: "情绪表达克制，优先落在动作失衡、环境回声和对白潜台词上。",
      deepTextureTraits: "视角贴身，偶尔借闪回压暗当前场景，留白靠短段和断句完成。",
      sensoryPalette: "以视觉、触觉和听觉为主，少量气味用于抬高不安感。",
    });
  }

  if (systemPrompt.includes("风格规则编译器")) {
    return JSON.stringify({
      narrativeDistance: "叙述紧贴人物眼前所见所误判，不抬头做总括。",
      infoReveal: "信息借对白碰撞和动作结果渗出，不额外补讲背景说明。",
      openingStrategy: "开篇直接用冲突中的对白或异动起势，后接动作压迫，不先铺高空背景。",
      chapterClosure: "章末只留一记余震，让风险悬在下一章门口。",
      paragraphCadence: "叙述段偏短，常用碎段追着动作和压迫感推进。",
      dialogueStyle: "对白极简单句为主，前后不补语境解释，靠顶句和打断制造压强。",
      emotionRendering: "情绪落在呼吸发紧、手上发麻和环境回声里，不明说结论。",
      pacing: "句子短促起落，转折时允许硬切，不能写成均匀说明文。",
      imageryRule: "意象只保留冷硬触感和压迫物件，不铺陈抒情比喻。",
      aiSmellPatterns: ["对白解释语境", "章末替角色总结", "把压迫感写成抽象判断"],
      styleTaboos: ["总结腔", "空转抒情", "匀速说明句"],
      signaturePatterns: ["对白顶句起势", "碎段追动作", "章末留余震"],
      rhetoricRule: "修辞低频而精准，优先保留冷硬物件比喻和环境拟人，避免甜腻抒情。",
      rhythmDNARule: "张力曲线递升，冲突前允许短句连发，段落呼吸整体收紧。",
      emotionSpectrumRule: "情绪表达以克制外化为主，优先身体反应、环境回声与对白潜台词。",
      perspectiveRule: "视角贴身，偶尔借闪回压暗当前局势，再迅速拉回现场。",
      sensoryRule: "视觉、触觉、听觉优先，嗅觉只在危险或旧案回潮时点刺。",
    });
  }

  if (systemPrompt.includes("出版编辑部的风格内参撰稿人")) {
    return `这套笔法的辨识度，不来自堆叠辞藻，而来自“修辞偏好、节奏 DNA、情绪策略、深层笔触”四条线同时压在动作链上。先看指纹底盘：章均体量大约在 2500 字，句长均值约 20 字，对白占比接近三成，一句一段比例约三成。这组数据意味着它天然偏向高压场景推进，而不是抒情型铺陈。修辞手法偏好也因此非常克制，显性比喻低频但命中冷硬触点，环境拟人只在需要抬压时落针。换句话说，修辞不是装饰，而是把门轴、雨线、灯影、潮气这些物件变成压力传导器，让读者在触感上先“被推着走”，再理解情节。\n\n叙事节奏 DNA 呈现出清晰的递升波形。短句占比约三分之一、长句占比不到一成，配合偏高的一句一段比例，使它在冲突前后能快速切换呼吸频率。更关键的是开篇入口分布：场景开篇、对白开篇与动作开篇长期并存，内省开篇比例被压得较低，说明叙事镜头默认先把读者扔进局面，再补认知，不会先写高空判断。于是段落推进看起来像“先撞击、再回声、再逼近”的三拍结构：动作先行，停顿跟进，潜台词再补刀。它极少容忍匀速叙述，尤其不接受把机制、风险、关系一次讲透的说明段。\n\n情绪渲染策略同样可被指纹侧证。对白占比与短句密度共同抬高了潜台词承载量，情绪往往不通过命名词直接宣告，而是通过呼吸、疼痛、失衡动作与环境回响间接显形。深层笔触上，这套写法坚持贴身视角，偶尔只给极短的时间切片，留白依靠断句和段落空隙完成，不靠总结句收束。感官通道偏好明确偏向视觉、触觉、听觉，嗅觉只在旧案回潮或危险逼近时点刺一下，形成“先看见/碰到/听到，再反应”的阅读链路。最终效果是：文本表面克制，内层持续增压，章末常留下余震而非结论，这正是它稳定可复用的风格签名。`;
  }

  if (systemPrompt.includes("资深文学编辑")) {
    return JSON.stringify({
      narrativeDistance: "贴近人物即时感受，少做高空解释。",
      infoDelivery: "信息随动作和对白推进，不用旁白先交代结论。",
      paragraphRhythm: "叙述与对白交替，关键动作处用短段压紧。",
      dialogueBreathing: "对白有留白，靠关系压强和停顿传递冲突。",
      emotionRendering: "情绪多落在身体反应与环境反射上。",
      chapterClosure: "章末留后患和余震，不做总结。",
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
    rhetoricRegister: {
      densityRule: "修辞只在关键处落针，不让比喻和拟人盖过动作本身。",
      preferredDevices: "优先冷硬物件比喻、环境拟人与克制对比句。",
      avoidDevices: ["甜腻抒情", "连续排比", "空转金句"],
    },
    narrativeRhythmDNA: {
      pacingPattern: "整体递升，危险逼近前允许短句和碎段连发。",
      tensionRule: "张力要沿动作、停顿和对白顶撞逐层上拧，不做平推。",
      breathingRule: "段落呼吸偏紧，长段只留给完整动作链。",
    },
    emotionSpectrum: {
      renderingPreference: "情绪优先外化到身体反应、环境回声和对白潜台词。",
      restraintRule: "能不明说就不明说，把结论压在动作后面。",
      transitionRule: "情绪转折要由局势变化或旧记忆刺入带出。",
    },
    deepTexture: {
      perspectiveRule: "视角贴身，默认锁在当前人物的即时感受里。",
      temporalRule: "只在必要时短切闪回或旧案残影，不长篇倒叙。",
      whitespaceRule: "留白靠短段、断句和省略解释完成。",
      sensoryRule: "优先调动视觉、触觉和听觉，嗅觉用于点刺危险与旧事回潮。",
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
    writingCharter: {
      chapterLengthRule: "章长保持完整场景推进，不短成梗概，也不要重复回钉凑字。",
      openingMoveRule: "开篇直接落动作和危险，不先抬高空背景。",
      infoRevealRule: "信息跟着动作链自然显形，不提前抽象定义。",
      mechanismRevealRule: "机制类信息先让角色撞上代价或异动，再补最少必要辨认。",
      mechanismRevealRedlines: [
        "不要写成解释 -> 验证 -> 总结三段式。",
        "不要在角色尚未吃到代价前先复述机制条款。",
      ],
      emotionLandingRule: "情绪落在呼吸、疼痛和环境压强上。",
      chapterClosureRule: "章末只钉一个新后患，不回钉总结。",
      transitionRule: "转场靠动作结果和视线牵引。",
      pauseRule: "停顿落在呼吸、动作和环境反馈上。",
      endingPolicy: {
        maxConclusionSentences: 1,
        conclusionMarkers: ["这意味着", "这说明", "总之"],
      },
      mechanismRevealPolicy: {
        maxExplicitSummarySentences: 1,
        maxTriadPatterns: 0,
        explanationMarkers: ["这意味着", "这说明", "也就是说"],
        verificationMarkers: ["果然", "下一刻", "随即"],
        summaryMarkers: ["这也说明", "总之", "可见"],
        mechanismKeywords: ["机制", "灵纹", "门道"],
      },
      transitionBudget: {
        maxContrastTemplates: 1,
        maxAbruptTurns: 2,
        maxHardTransitionMarkers: 4,
        hardTransitionMarkers: ["忽然", "骤然", "下一刻"],
      },
      simileBudget: {
        maxPerChapter: 4,
        maxPerParagraph: 1,
      },
      rhetoricBudget: {
        simileDensityPerThousand: 1.6,
        personificationDensityPerThousand: 0.6,
        rhetoricalQuestionPerChapter: 1,
        dominantDevice: "simile",
      },
      subjectLeadBudget: {
        maxPronounLeads: 4,
        maxDominantLeadCount: 6,
        maxSameLeadInWindow: 2,
        windowSize: 6,
      },
      motifReuseBudget: {
        maxPerMotif: 3,
        minParagraphSpan: 2,
        minMotifLength: 2,
        stopwords: ["自己", "时候"],
      },
      sensoryBudget: {
        sensoryDetailTargetPerThousand: 5.4,
        primaryChannels: ["visual", "tactile", "auditory"],
      },
      aiFlavorAvoidance: ["解释先于行动", "机械转折", "机制复述"],
      tabooReminders: ["空转比喻", "总结腔"],
    },
    aiSmellPatterns: ["解释过早", "句式平均"],
    styleTaboos: ["空转比喻", "总结腔"],
  });
}

test("generateStyleCardSnapshot builds a book snapshot from imported excerpts with bounded digest and exemplars", async () => {
  const snapshot = await generateStyleCardSnapshot({
    id: "snapshot-book-1",
    projectId: "project-style-test",
    mode: "book",
    imports: [createImport("import-1", "长夜潮声", "沈知白", 86)],
    version: 1,
    genre: "悬疑",
    premise: "主角必须冒夜禁去追一条旧线索。",
    manualGuidance: "把压迫感和对白张力保住。",
    avoidances: "不要解释腔。",
    llmCall: fakeStyleLlm,
  });

  assert.equal(snapshot.mode, "book");
  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.sourceIds.length, 1);
  assert.equal(snapshot.styleDigest.length >= 1_200, true);
  assert.equal(snapshot.styleDigest.length <= 1_800, true);
  assert.equal(snapshot.styleExemplars.length >= 2, true);
  assert.equal(snapshot.styleExemplars.length <= 4, true);
  assert.match(snapshot.styleCard, /风格签名/);
  assert.match(snapshot.styleCard, /作者习惯卡/);
  assert.match(snapshot.styleCard, /风格维度速记/);
  assert.match(snapshot.styleCard, /修辞手法偏好/);
  assert.match(snapshot.styleCard, /叙事节奏 DNA/);
  assert.match(snapshot.styleCard, /情绪渲染策略/);
  assert.match(snapshot.styleCard, /深层笔触与感官通道/);
  assert.match(snapshot.styleCard, /文体指纹：章均/);
  assert.match(snapshot.styleProfile.writingCharter?.mechanismRevealRule ?? "", /代价|异动/);
  assert.match(snapshot.styleDigest, /机制露出|机制类信息/);
  assert.match(snapshot.styleDigest, /修辞|比喻/);
  assert.match(snapshot.styleDigest, /张力|节奏DNA|递升/);
  assert.match(snapshot.styleDigest, /情绪|克制/);
  assert.match(snapshot.styleDigest, /深层笔触|视角|感官/);
  assert.match(snapshot.styleDigest, /章均|对白占比|句长|短句/);
  assert.match(snapshot.styleProfile.writingCharter?.chapterLengthRule ?? "", /参考原作章均/);
  assert.match(snapshot.styleProfile.rhetoricRegister.densityRule, /修辞/);
  assert.match(snapshot.styleProfile.deepTexture.sensoryRule, /视觉|触觉|听觉/);
});

test("generateStyleCardSnapshot uses the fingerprint-aware map-reduce path when fingerprint is present", async () => {
  let callCount = 0;

  const snapshot = await generateStyleCardSnapshot({
    id: "snapshot-book-map-reduce",
    projectId: "project-style-test",
    mode: "book",
    imports: [createImport("import-map-reduce-1", "潮痕旧巷", "测试作者", 120)],
    version: 6,
    genre: "悬疑",
    llmCall: async (messages) => {
      callCount += 1;
      return fakeStyleLlm(messages);
    },
  });

  assert.equal(callCount > 2, true);
  assert.match(snapshot.styleProfile.writingCharter?.chapterLengthRule ?? "", /参考原作章均/);
  assert.equal((snapshot.styleProfile.writingCharter?.rhetoricBudget?.simileDensityPerThousand ?? 0) > 0, true);
});

test("generateStyleCardSnapshot falls back to the legacy two-step path when fingerprint is unavailable", async () => {
  let callCount = 0;
  const importEntry = createImport("import-legacy-1", "旧路归灯", "测试作者", 40);
  delete importEntry.fingerprint;
  delete importEntry.normalizedText;

  await generateStyleCardSnapshot({
    id: "snapshot-book-legacy",
    projectId: "project-style-test",
    mode: "book",
    imports: [importEntry],
    version: 7,
    genre: "悬疑",
    llmCall: async (messages) => {
      callCount += 1;
      return fakeStyleLlm(messages);
    },
  });

  assert.equal(callCount, 2);
});

test("generateStyleCardSnapshot caps two-book author mode confidence at medium", async () => {
  const snapshot = await generateStyleCardSnapshot({
    id: "snapshot-author-1",
    projectId: "project-style-test",
    mode: "author",
    imports: [
      createImport("import-1", "长夜潮声", "沈知白", 118),
      createImport("import-2", "雾中山门", "沈知白", 112),
    ],
    version: 2,
    genre: "悬疑",
    premise: "主角卷入一场会吞噬记忆的追猎。",
    manualGuidance: "只保留稳定的共通写法。",
    avoidances: "不要模板句。",
    llmCall: fakeStyleLlm,
  });

  assert.equal(snapshot.mode, "author");
  assert.equal(snapshot.confidence, "medium");
  assert.equal(snapshot.sourceIds.length, 2);
  assert.equal(snapshot.sampledExcerpts.length > snapshot.styleExemplars.length, true);
  assert.equal(snapshot.styleDigest.length >= 1_200, true);
});

test("generateStyleCardSnapshot keeps short-book exemplars inside the runtime guard window", async () => {
  const snapshot = await generateStyleCardSnapshot({
    id: "snapshot-book-short",
    projectId: "project-style-test",
    mode: "book",
    imports: [createShortImport("import-short-1", "长夜回潮", "测试作者")],
    version: 3,
    genre: "悬疑",
    premise: "巡夜人违令追查旧案。",
    llmCall: fakeStyleLlm,
  });

  assert.equal(snapshot.styleExemplars.length >= 2, true);
  assert.equal(snapshot.styleExemplars.every((entry) => entry.content.length >= 120), true);
  assert.equal(snapshot.styleExemplars.every((entry) => entry.content.length <= 320), true);
});

test("generateStyleCardSnapshot keeps a mechanism-first exemplar when source excerpts contain implicit reveal beats", async () => {
  const snapshot = await generateStyleCardSnapshot({
    id: "snapshot-book-mechanism",
    projectId: "project-style-test",
    mode: "book",
    imports: [createMechanismImport("import-mechanism-1", "灵痕夜行", "测试作者")],
    version: 4,
    genre: "玄幻",
    premise: "主角被迫试探一枚会反咬的灵纹。",
    llmCall: fakeStyleLlm,
  });

  assert.equal(snapshot.sampledExcerpts.some((entry) => entry.tags.includes("mechanism")), true);
  assert.equal(snapshot.styleExemplars.some((entry) => entry.tags.includes("mechanism")), true);
});

test("generateStyleCardSnapshot keeps scene-aware exemplars for hook, silence, and pressure when source excerpts provide them", async () => {
  const snapshot = await generateStyleCardSnapshot({
    id: "snapshot-book-scene-aware",
    projectId: "project-style-test",
    mode: "book",
    imports: [createSceneAwareImport("import-scene-aware-1", "风缝旧响", "测试作者")],
    version: 5,
    genre: "悬疑",
    premise: "主角在门外逼近前听见下一场麻烦的钩子。",
    llmCall: fakeStyleLlm,
  });

  assert.equal(snapshot.sampledExcerpts.some((entry) => entry.tags.includes("silence")), true);
  assert.equal(snapshot.sampledExcerpts.some((entry) => entry.tags.includes("pressure")), true);
  assert.equal(snapshot.sampledExcerpts.some((entry) => entry.tags.includes("hook")), true);
  assert.equal(snapshot.styleExemplars.some((entry) => entry.tags.includes("silence")), true);
  assert.equal(snapshot.styleExemplars.some((entry) => entry.tags.includes("pressure")), true);
  assert.equal(snapshot.styleExemplars.some((entry) => entry.tags.includes("hook")), true);
});

test("generateStyleCardSnapshot keeps book exemplars spread across multiple sampled chapters for long-form imports", async () => {
  const snapshot = await generateStyleCardSnapshot({
    id: "snapshot-book-diverse-exemplars",
    projectId: "project-style-test",
    mode: "book",
    imports: [createImport("import-diverse-1", "万山回潮", "测试作者", 120)],
    version: 8,
    genre: "玄幻",
    llmCall: fakeStyleLlm,
  });

  const distinctLabels = new Set(snapshot.styleExemplars.map((entry) => entry.label));

  assert.equal(distinctLabels.size >= 3, true);
  assert.equal(snapshot.styleExemplars.some((entry) => entry.positionRatio > 0.5), true);
});
