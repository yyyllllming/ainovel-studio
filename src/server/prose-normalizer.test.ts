import test from "node:test";
import assert from "node:assert/strict";
import {
  assessProseStyleRisk,
  inspectProseStyleSignals,
  normalizeGeneratedChapterContent,
} from "./writing/prose-normalizer.ts";
import { createDefaultStyleProfile } from "./style/style-steering.ts";

test("normalizeGeneratedChapterContent merges over-split narrative sentences", () => {
  const input = [
    "夜里风很紧。",
    "",
    "码头的木板被吹得发响。",
    "",
    "我站在雨棚下，看见那个人终于从雾里走出来。",
  ].join("\n");

  const output = normalizeGeneratedChapterContent(input);
  assert.equal(
    output,
    "夜里风很紧。码头的木板被吹得发响。\n\n我站在雨棚下，看见那个人终于从雾里走出来。",
  );
});

test("normalizeGeneratedChapterContent keeps dialogue paragraphs separate", () => {
  const input = [
    "我把伞收起来。",
    "",
    "“你还是来了。”",
    "",
    "他没有看我，只把手里的火机按亮又熄灭。",
  ].join("\n");

  const output = normalizeGeneratedChapterContent(input);
  assert.equal(
    output,
    "我把伞收起来。\n\n“你还是来了。”\n\n他没有看我，只把手里的火机按亮又熄灭。",
  );
});

test("inspectProseStyleSignals flags repeated pronoun-led narrative sentences and template overuse", () => {
  const input = [
    "咿呀伏在石缝边，先听风里的动静。",
    "它不敢抬头，只把耳朵一点点竖起来。",
    "它盯着黑暗深处，后背细毛都绷紧了。",
    "它又往后退了半步，爪尖却没有离开湿石。",
    "像有什么东西在黑暗里挪了一下，像冷水沿着脊骨慢慢流下。",
    "不是它胆小，而是那股气息离得太近，近得像已经贴到鼻尖。",
    "不是山风，而是石腔更深处某种活物的呼吸。",
  ].join("");

  const result = inspectProseStyleSignals(input);

  assert.equal(result.pronounLeadCount >= 3, true);
  assert.equal(result.contrastTemplateCount >= 2, true);
  assert.equal(result.repeatedSentenceStarts.some((entry) => entry.lead === "它" && entry.count >= 3), true);
  assert.equal(result.warnings.some((entry) => entry.includes("代词")), true);
  assert.equal(result.warnings.some((entry) => entry.includes("不是……而是")), true);
});

test("inspectProseStyleSignals surfaces moment markers, explanation leads, judgment leads, and phrase reuse", () => {
  const input = [
    "这一瞬，姜离先听见岩缝里像有东西在换气。",
    "这一息，他意识到脚下那层湿土不是泥，而是某种正在退开的壳。",
    "这意味着他若再往前半步，整条裂缝都会惊醒。",
    "更像是一只伏着不动的巨口，在黑暗里慢慢张开。",
    "偏偏那股腥气没有散，反而一点点压进胸口。",
    "偏偏那股腥气没有散，反而一点点压进胸口。",
    "偏偏那股腥气没有散，反而一点点压进胸口。",
  ].join("");

  const result = inspectProseStyleSignals(input);

  assert.equal(result.momentMarkerCount >= 2, true);
  assert.equal(result.explanationLeadCount >= 2, true);
  assert.equal(result.judgmentLeadCount >= 1, true);
  assert.equal(result.phraseReuseHits.some((entry) => entry.phrase === "偏偏" && entry.count >= 3), true);
  assert.equal(result.warnings.some((entry) => entry.includes("这一瞬")), true);
  assert.equal(result.warnings.some((entry) => entry.includes("解释")), true);
});

test("assessProseStyleRisk marks model-like repetition as fail", () => {
  const input = [
    "它伏在石后，盯着谷底的血光。",
    "它没有立刻扑下去，只把尾巴紧紧收住。",
    "它又抬头看了一眼，耳尖轻轻一抖。",
    "它听见藤身里有水声一样的东西在爬。",
    "它再往前挪时，四爪都压得极轻。",
    "它盯着那枚赤果，连呼吸都一点点收紧。",
    "它明知不对，却还是舍不得挪开视线。",
    "像有冷蛇沿着它的脊背慢慢往上爬，像有细针一点点扎进骨缝。",
    "不是它胆小，而是那股血腥气已经贴到了鼻尖。",
    "不是风太冷，而是谷底那株怪藤像活物一样在喘。",
    "像裂开的伤口，像夜里睁开的眼。",
    "不是它想退，而是那股凶气已经像手一样按在它头顶。",
  ].join("");

  const result = assessProseStyleRisk(input);

  assert.equal(result.severity, "fail");
  assert.equal(result.shouldForceDeepReview, true);
  assert.equal(result.shouldRetryStylePass, true);
  assert.equal(result.notes.some((entry) => entry.includes("代词起句")), true);
  assert.equal(result.notes.some((entry) => entry.includes("比喻")), true);
});

test("assessProseStyleRisk tracks repeated proper-name sentence starts", () => {
  const input = [
    "咿呀伏在石缝边，盯着谷底的血光。",
    "咿呀没有立刻扑下去，只把尾巴紧紧收住。",
    "咿呀又抬头看了一眼，耳尖轻轻一抖。",
    "咿呀听见藤身里有水声一样的东西在爬。",
    "咿呀再往前挪时，四爪都压得极轻。",
    "咿呀盯着那枚赤果，连呼吸都一点点收紧。",
  ].join("");

  const result = assessProseStyleRisk(input);

  assert.equal(result.dominantLead?.lead, "咿呀");
  assert.equal(result.severity, "ok");
});

test("assessProseStyleRisk ignores closing quotes when extracting sentence leads", () => {
  const input = [
    "”姜离伏在石后，没有立刻扑下去。",
    "”姜离又抬头看了一眼，耳尖轻轻一抖。",
    "”姜离听见藤身里有水声一样的东西在爬。",
    "”姜离再往前挪时，四爪都压得极轻。",
    "”姜离盯着那枚赤果，连呼吸都一点点收紧。",
  ].join("");

  const result = assessProseStyleRisk(input);

  assert.equal(result.dominantLead?.lead, "姜离");
  assert.equal(result.notes.some((entry) => entry.includes("”")), false);
});

test("assessProseStyleRisk leaves varied prose as ok", () => {
  const input = [
    "山风掠过林梢，湿叶彼此摩擦，发出细碎轻响。",
    "咿呀贴着岩面缓缓挪动，先看见谷底那道断开的兽尸，再看见旁边尚未干透的血线。",
    "它没有急着靠近，只用鼻尖轻轻一碰，便立刻退开。",
    "这味道不对，像是刚死，又像是被什么东西从里面吸空了。",
    "远处忽有碎石滚落，小兽立刻伏低身子，把呼吸压进胸腔里。",
  ].join("");

  const result = assessProseStyleRisk(input);

  assert.equal(result.severity, "ok");
  assert.equal(result.shouldForceDeepReview, false);
  assert.equal(result.notes.length, 0);
});

test("inspectProseStyleSignals counts broader simile markers", () => {
  const input = [
    "山风压下来，如同冷砂灌进领口。",
    "石壁上的潮气宛如一层冷膜，贴在爪尖上不散。",
    "它抬头时，似乎连呼吸都被崖缝收紧了。",
  ].join("");

  const result = inspectProseStyleSignals(input);

  assert.equal(result.simileCount >= 3, true);
});

test("assessProseStyleRisk aligns with writingCharter thresholds when provided", () => {
  const charter = createDefaultStyleProfile().writingCharter!;
  const input = [
    "姜离伏在石后，没有立刻起身。",
    "裂爪青狼沿着崖豁压了出来。",
    "黑羽鹫落在横生石棱上，喙尖轻敲旧岩。",
    "它先闻见血腥。",
    "它又往后缩了半步。",
    "它盯着姜离右手，鼻端轻轻抽动。",
    "它没有立刻扑下去。",
    "胸口像被火钩住，仿佛骨缝都在发紧。",
    "石层如同被热水泡开，边角一点点外翻。",
    "不是山风，而是崖下那头东西先动了。",
  ].join("");

  const result = assessProseStyleRisk(input, charter);

  assert.equal(result.severity, "ok");
  assert.equal(result.notes.every((entry) => !entry.includes("代词起句")), true);
  assert.equal(result.notes.every((entry) => !entry.includes("不是……而是……")), true);
});

test("assessProseStyleRisk marks explanation-heavy template prose as warn or fail", () => {
  const input = [
    "这一瞬，姜离听见裂缝深处像有石片彼此轻轻磨动。",
    "这一息，他意识到那不是回声，而是某种活物正在换壳。",
    "这意味着他若再往前一步，就会把整片黑土都惊醒。",
    "这说明先前那层热痕根本不是死物留下的烙印。",
    "更像是一张伏在崖底缓缓张开的嘴。",
    "带着一种不该出现在山石里的潮湿呼吸。",
    "偏偏那股气息没有散，反而一点点压进胸口。",
    "偏偏那股气息没有散，反而一点点压进胸口。",
    "偏偏那股气息没有散，反而一点点压进胸口。",
  ].join("");

  const result = assessProseStyleRisk(input);

  assert.equal(result.severity === "warn" || result.severity === "fail", true);
  assert.equal(result.notes.some((entry) => entry.includes("解释补句")), true);
  assert.equal(result.notes.some((entry) => entry.includes("词块回钉")), true);
});
