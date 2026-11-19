import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeStyleFingerprint } from "./style-fingerprint.ts";

describe("computeStyleFingerprint", () => {
  const sampleText = `第一章 黎明

天还没亮，他已经在路上了。背包压着肩膀，脚步不算快，但一直没停。

"你不该来的。"她站在门口，声音很轻。

他没回头。风把衣角吹开，露出里面绑着的绷带。她看见了，什么也没说。

巷子很窄。两边的墙长满了青苔，头顶搭着晾衣绳。他侧身挤过去，肩上的伤口又裂开了。

第二章 集市

集市上人很多。叫卖声、讨价还价的嗓门、孩子的哭闹混在一起。他低着头走，尽量不引人注意。

"三块一斤，不还价。"摊主是个胖女人，嗓门比谁都大。

他从口袋里摸出几枚硬币，数了数，不够。`;

  it("should compute sentence length statistics", () => {
    const secondChapterOffset = sampleText.indexOf("第二章");
    const sections = [{
      title: "第一章",
      content: sampleText.slice(0, secondChapterOffset),
      startOffset: 0,
      endOffset: secondChapterOffset,
    }];
    const fp = computeStyleFingerprint(sampleText, sections);
    assert.ok(fp.sentenceLength.mean > 0);
    assert.ok(fp.sentenceLength.shortRatio >= 0 && fp.sentenceLength.shortRatio <= 1);
  });

  it("should detect dialogue ratio", () => {
    const fp = computeStyleFingerprint(sampleText, []);
    assert.ok(fp.dialogue.overallRatio > 0.05, "should detect dialogue");
    assert.ok(fp.dialogue.overallRatio < 0.5, "dialogue should not be majority");
  });

  it("should compute punctuation frequencies", () => {
    const fp = computeStyleFingerprint(sampleText, []);
    assert.ok(fp.punctuation.comma > 0);
    assert.ok(fp.punctuation.period > 0);
  });

  it("should handle text with no chapters gracefully", () => {
    const fp = computeStyleFingerprint("这是一段简短的测试文本。没有章节。", []);
    assert.equal(fp.chapter.count, 0);
    assert.ok(fp.sentenceLength.mean > 0);
  });

  it("should compute vocabulary uniqueRatio", () => {
    const fp = computeStyleFingerprint(sampleText, []);
    assert.ok(fp.vocabulary.uniqueRatio > 0 && fp.vocabulary.uniqueRatio <= 1);
    assert.ok(fp.vocabulary.topBigrams.length > 0);
  });

  it("should compute deterministic rhetoric, rhythm, emotion, and deep texture signals", () => {
    const fingerprintText = `夜色像潮水一样漫过街口，风在门缝里低低喘气，像有人把冷意一寸寸推上来。

“难道你还要往前？”她没有拦，只把灯举高了一点，声音却亮得发白，像铁片擦过玻璃。

他想起三年前那场火，忽然觉得喉咙里也有一层灰。不是他不肯退，而是那道门后偏偏还压着另一个名字。

院门外先是脚步，再是铜铃，再是一阵更近的犬吠。雨味贴在皮肤上，冷得发涩，灯影也跟着发颤。

次日清晨，他已经站到白石桥口。桥下水声亮得刺眼，像有人把昨夜没说完的话重新照了出来。`;
    const fp = computeStyleFingerprint(fingerprintText, []);

    assert.ok(fp.rhetoric.simileCount >= 3);
    assert.ok(fp.rhetoric.simileDensity > 0);
    assert.ok(fp.rhetoric.personificationCount >= 1);
    assert.ok(fp.rhetoric.synesthesiaCount >= 1);
    assert.ok(fp.rhetoric.contrastIronyCount >= 1);
    assert.ok(fp.rhetoric.rhetoricalQuestionCount >= 1);
    assert.notEqual(fp.rhetoric.dominantDevice, "none");
    assert.ok(fp.narrativeRhythm.sceneChangeFrequency >= 0);
    assert.ok(fp.narrativeRhythm.shortBurstRatio >= 0 && fp.narrativeRhythm.shortBurstRatio <= 1);
    assert.ok(fp.narrativeRhythm.longFlowRatio >= 0 && fp.narrativeRhythm.longFlowRatio <= 1);
    assert.ok(fp.narrativeRhythm.rhythmVariance >= 0);
    assert.ok(["rising", "oscillating", "plateau", "climactic"].includes(fp.narrativeRhythm.tensionCurveShape));
    assert.ok(["tight", "mixed", "expansive"].includes(fp.narrativeRhythm.paragraphBreathingPattern));
    assert.ok(fp.emotionRendering.actionBasedRatio >= 0 && fp.emotionRendering.actionBasedRatio <= 1);
    assert.ok(fp.emotionRendering.environmentBasedRatio >= 0 && fp.emotionRendering.environmentBasedRatio <= 1);
    assert.ok(fp.emotionRendering.introspectionRatio >= 0 && fp.emotionRendering.introspectionRatio <= 1);
    assert.ok(fp.emotionRendering.dialogueSubtextRatio >= 0 && fp.emotionRendering.dialogueSubtextRatio <= 1);
    assert.ok(fp.emotionRendering.sensoryDetailDensity > 0);
    assert.ok(fp.emotionRendering.restraintScore >= 0 && fp.emotionRendering.restraintScore <= 1);
    assert.ok(fp.deepTexture.perspectiveShiftCount >= 0);
    assert.ok(fp.deepTexture.temporalDeviceCount >= 1);
    assert.ok(fp.deepTexture.whitespaceRatio >= 0 && fp.deepTexture.whitespaceRatio <= 1);
    assert.ok(fp.deepTexture.informationDensity > 0 && fp.deepTexture.informationDensity <= 1);
    assert.ok(fp.deepTexture.imageClusterCount >= 1);
    assert.ok(fp.deepTexture.sensoryChannelDistribution.auditory >= 0);
    assert.ok(fp.deepTexture.sensoryChannelDistribution.olfactory >= 0);
    assert.ok(fp.deepTexture.sensoryChannelDistribution.gustatory >= 0);
    assert.ok(fp.deepTexture.sensoryChannelDistribution.tactile >= 0);
    assert.ok(fp.deepTexture.sensoryChannelDistribution.kinesthetic >= 0);
    assert.ok(fp.deepTexture.sensoryChannelDistribution.visual >= 0);
  });

  it("should return safe default values for all new blocks on empty text", () => {
    const fp = computeStyleFingerprint("", []);

    assert.equal(fp.rhetoric.simileCount, 0);
    assert.equal(fp.rhetoric.dominantDevice, "none");
    assert.equal(fp.narrativeRhythm.sceneChangeFrequency, 0);
    assert.equal(fp.narrativeRhythm.rhythmVariance, 0);
    assert.equal(fp.emotionRendering.actionBasedRatio, 0);
    assert.equal(fp.emotionRendering.environmentBasedRatio, 0);
    assert.equal(fp.emotionRendering.introspectionRatio, 0);
    assert.equal(fp.emotionRendering.dialogueSubtextRatio, 0);
    assert.equal(fp.emotionRendering.sensoryDetailDensity, 0);
    assert.equal(fp.deepTexture.perspectiveShiftCount, 0);
    assert.equal(fp.deepTexture.temporalDeviceCount, 0);
    assert.ok(fp.deepTexture.whitespaceRatio >= 0 && fp.deepTexture.whitespaceRatio <= 1);
    assert.ok(fp.deepTexture.informationDensity >= 0 && fp.deepTexture.informationDensity <= 1);
    assert.equal(fp.deepTexture.imageClusterCount, 0);
  });
});
