import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanImportedReferenceText,
  decodeStyleReferenceBuffer,
  prepareStyleReferenceImport,
  resolveStyleImportConfidence,
  sampleStyleExcerpts,
  splitStyleReferenceSections,
  trimExcerptForExemplar,
} from "./style/style-reference-import.ts";

function buildReferenceChapter(index: number) {
  const narrative = `第${index}章 风起\n山路贴着悬崖蜿蜒下去，潮湿的雾顺着石缝往人骨头里钻。林霁背着药篓走得很慢，每一步都像踩在旧年债上。`;
  const dialogue = `\n\n“你还要往前？”沈砚把灯提高，声音压得很低，“再走一步，夜禁就不是规矩，是要命。”林霁没看他，只把袖口往上一抹：“要命也得去。”`;
  const conflict = `\n\n山口忽然响起铁器碰撞声，巡夜人从黑里扑出来，刀背劈在石栏上，火星一串串蹦开。林霁侧身撞进雨里，肩胛被震得发麻，脚下一滑，几乎整个人都要翻下去。`;
  const emotion = `\n\n那一下失重逼得他心口发空，指尖却更紧地抠住湿冷石缝。恐惧像冰水灌进肺里，连呼吸都在发抖，可他偏偏在发抖里想起母亲临终前那句没说完的话。`;
  const tail = `\n\n他稳住身子，听见远处铜铃一下一下地晃，像有人故意把更大的麻烦摇给他听。`;
  return `${narrative}${dialogue}${conflict}${emotion}${tail}`;
}

function buildLargeReference(chapters: number) {
  return Array.from({ length: chapters }, (_, index) => buildReferenceChapter(index + 1)).join("\n\n");
}

function buildMechanismReference(chapters: number) {
  const chapter = `第%s章 灵痕
石缝里那道灵纹先是暗了一瞬，随即贴着岩皮慢慢游开，像有活物在石层底下换气。林霁没敢碰，只把掌心更轻地压上去，指骨立刻传来一阵细碎发麻，像有什么东西顺着血路往里试探。

他刚想收手，纹路又亮了一线，碎光沿着虎口一掠而过，随即熄了下去。那一下并没有给出答案，只留下更尖一点的刺痛和一缕并不属于他的冷气，像是某种门路刚露了个边。

“别再试。”沈砚只低低说了一句，灯火却跟着往后挪了半步。林霁没有应声，只盯着手背上那点很快淡下去的细痕，知道这东西已经记住了自己。`;
  return Array.from({ length: chapters }, (_, index) => chapter.replace("%s", String(index + 1))).join("\n\n");
}

function buildSceneAwareReference(chapters: number) {
  const chapter = `第%s章 风缝
他没有接话，只把沾血的手指慢慢蜷回袖里，盯着门槛边那道被雨水泡开的旧痕。屋里一时谁也没动，只有灯火在碗口里轻轻晃，像有一句更重的话压着不肯落地。

院门外的脚步声比先前更近了一层，先是两个人，后来像又添了第三个人。木门没有立刻被撞开，可门轴已经开始一下比一下更紧地呻吟，连窗纸上的影子都被逼得薄了一层。

远处忽然传来一声极轻的铜响，像是谁把下一场麻烦先挂到了风里。那声音只晃了一下就停，却让他知道今夜还远没收束。`;
  return Array.from({ length: chapters }, (_, index) => chapter.replace("%s", String(index + 1))).join("\n\n");
}

test("decodeStyleReferenceBuffer falls back to gb18030-compatible input and keeps readable Chinese text", () => {
  const buffer = Buffer.from("b5dad2bbd5c220b7e7c6f0606ecbfbd5bed4dac3c5c7b0a1a3606e", "hex");
  const decoded = decodeStyleReferenceBuffer(buffer);

  assert.equal(decoded.encoding, "gb18030");
  assert.match(decoded.text, /第一章/);
  assert.match(decoded.text, /他站在门前/);
});

test("cleanImportedReferenceText removes common page noise and collapses blank lines", () => {
  const cleaned = cleanImportedReferenceText(`
------------ 章节目录 ------------
以下是啃书小说网KenShu.CC收集并整理,版权归作者或出版社。
最新网址：www.example.com
# 第一章 风起

“先回去。”他说。

本章未完，请点击下一页继续阅读

山雨压下来。

返回目录
  `);

  assert.doesNotMatch(cleaned, /最新网址/);
  assert.doesNotMatch(cleaned, /啃书小说网/);
  assert.doesNotMatch(cleaned, /版权归作者或出版社/);
  assert.doesNotMatch(cleaned, /章节目录/);
  assert.doesNotMatch(cleaned, /本章未完/);
  assert.match(cleaned, /第一章 风起/);
  assert.match(cleaned, /山雨压下来/);
  assert.equal(/\n{3,}/u.test(cleaned), false);
});

test("splitStyleReferenceSections falls back to a single body section when no chapter headings exist", () => {
  const sections = splitStyleReferenceSections("潮湿的风贴着门缝钻进来。\n\n她没有回头，只听见身后的铜锁轻轻一响。");

  assert.equal(sections.length, 1);
  assert.equal(sections[0]?.title, "正文片段");
});

test("sampleStyleExcerpts enforces count, distribution, coverage, dedupe, and dialogue-heavy cap", () => {
  const text = buildLargeReference(220);
  const sampled = sampleStyleExcerpts("source-a", "长夜潮声", text);

  assert.equal(sampled.confidence, "high");
  assert.equal(sampled.excerpts.length, 24);
  assert.equal(sampled.excerpts.some((entry) => entry.positionRatio <= 0.2), true);
  assert.equal(sampled.excerpts.some((entry) => entry.positionRatio > 0.2 && entry.positionRatio < 0.8), true);
  assert.equal(sampled.excerpts.some((entry) => entry.positionRatio >= 0.8), true);
  assert.equal(sampled.excerpts.some((entry) => entry.tags.includes("narrative")), true);
  assert.equal(sampled.excerpts.some((entry) => entry.tags.includes("dialogue")), true);
  assert.equal(sampled.excerpts.some((entry) => entry.tags.includes("conflict")), true);
  assert.equal(sampled.excerpts.some((entry) => entry.tags.includes("emotion")), true);
  assert.equal(sampled.excerpts.filter((entry) => entry.dialogueRatio > 0.85).length <= 4, true);

  for (let index = 1; index < sampled.excerpts.length; index += 1) {
    const previous = sampled.excerpts[index - 1]!;
    const current = sampled.excerpts[index]!;
    const overlap = Math.min(previous.endOffset, current.endOffset) - Math.max(previous.startOffset, current.startOffset);
    const ratio = overlap > 0
      ? overlap / Math.min(previous.endOffset - previous.startOffset, current.endOffset - current.startOffset)
      : 0;
    assert.equal(ratio > 0.6, false);
  }
});

test("resolveStyleImportConfidence uses the upgraded sampling thresholds", () => {
  assert.deepEqual(resolveStyleImportConfidence(7_999), { excerptCount: 8, confidence: "low" });
  assert.deepEqual(resolveStyleImportConfidence(19_999), { excerptCount: 12, confidence: "low" });
  assert.deepEqual(resolveStyleImportConfidence(49_999), { excerptCount: 18, confidence: "medium" });
  assert.deepEqual(resolveStyleImportConfidence(119_999), { excerptCount: 24, confidence: "high" });
  assert.deepEqual(resolveStyleImportConfidence(120_000), { excerptCount: 30, confidence: "high" });
});

test("prepareStyleReferenceImport produces normalized text and sampled excerpts for txt and md inputs", () => {
  const prepared = prepareStyleReferenceImport({
    buffer: Buffer.from(`# 第一章 风起

“先回去。”他说，“前面那段石阶已经开始吃人了。”

山雨压下来，石阶变得很滑，潮气顺着鞋底往上爬。他没有立刻转身，只是把掌心更深地压进刀柄里，像在硬撑一个不肯松口的念头。

“再迟一点，就真回不去了。”她的声音很轻，却像把风都压低了一寸。

铜铃在更深处轻轻晃了一下，像有人故意把更坏的消息递过来。
`, "utf8"),
    fileName: "sample.md",
    mediaType: "text/markdown",
    title: "山门夜雨",
    author: "测试作者",
  });

  assert.equal(prepared.title, "山门夜雨");
  assert.equal(prepared.author, "测试作者");
  assert.equal(prepared.encoding, "utf-8");
  assert.match(prepared.normalizedText, /第一章 风起/);
  assert.equal(prepared.excerpts.length > 0, true);
  assert.ok(prepared.fingerprint);
  assert.ok(prepared.fingerprint.chapter.count >= 1);
  assert.ok(prepared.fingerprint.vocabulary.topBigrams.length > 0);
});

test("sampleStyleExcerpts forces coverage of implicit mechanism reveal excerpts", () => {
  const text = buildMechanismReference(40);
  const sampled = sampleStyleExcerpts("source-mechanism", "灵痕夜行", text);

  const mechanismExcerpts = sampled.excerpts.filter((entry) => entry.tags.includes("mechanism"));
  assert.equal(mechanismExcerpts.length >= 1, true);
  assert.equal(
    mechanismExcerpts.some((entry) => !/这意味着|这说明|总之|也就是说/u.test(entry.content)),
    true,
  );
});

test("sampleStyleExcerpts captures scene-aware tags for hook, silence, and pressure when they are present", () => {
  const text = buildSceneAwareReference(40);
  const sampled = sampleStyleExcerpts("source-scene-aware", "风缝旧响", text);

  assert.equal(sampled.excerpts.some((entry) => entry.tags.includes("silence")), true);
  assert.equal(sampled.excerpts.some((entry) => entry.tags.includes("pressure")), true);
  assert.equal(sampled.excerpts.some((entry) => entry.tags.includes("hook")), true);
});

test("sampleStyleExcerpts keeps long-form coverage spread across many sampled chapters instead of collapsing into the opening", () => {
  const text = buildLargeReference(220);
  const sampled = sampleStyleExcerpts("source-long-form", "万山回潮", text);
  const labelCounts = new Map<string, number>();

  sampled.excerpts.forEach((entry) => {
    labelCounts.set(entry.label, (labelCounts.get(entry.label) ?? 0) + 1);
  });

  assert.equal(labelCounts.size >= 8, true);
  assert.equal(Math.max(...labelCounts.values()) <= 3, true);
  assert.equal(sampled.excerpts.some((entry) => entry.positionRatio >= 0.6), true);
});

test("prepareStyleReferenceImport upgrades long-form book confidence when sampled chapters cover the full book", () => {
  const sampledText = Array.from(
    { length: 10 },
    (_, index) => buildReferenceChapter([1, 2, 3, 409, 817, 1224, 1630, 2012, 2013, 2014][index] ?? (index + 1)),
  ).join("\n\n");

  const prepared = prepareStyleReferenceImport({
    buffer: Buffer.from(sampledText, "utf8"),
    fileName: "完美世界.txt",
    title: "完美世界",
    author: "辰东",
    samplingContext: {
      totalWordCount: 5_604_720,
      totalChapterCount: 2_065,
      sampledChapterCount: 10,
      sourceKind: "book_import",
    },
  });

  assert.equal(prepared.confidence, "high");
});

test("trimExcerptForExemplar keeps excerpts within the exemplar window", () => {
  const text = "潮气顺着袖口往里爬，他听见自己的心跳贴着耳膜发闷作响。".repeat(10);
  const exemplar = trimExcerptForExemplar(text);

  assert.equal(exemplar.length >= 150, true);
  assert.equal(exemplar.length <= 300, true);
});
