import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFoundationFallbackReply,
  buildFoundationStarterMessage,
  pickFoundationNextFocus,
} from "./foundation/foundation-workshop-copy.ts";

test("buildFoundationStarterMessage avoids questionnaire-style numbered prompts", () => {
  const message = buildFoundationStarterMessage({
    title: "洪荒异兽",
    genre: "玄幻",
    style: "default",
    premise: "一个山海经风格的成长故事",
  });

  assert.equal(message.includes("1."), false);
  assert.equal(message.includes("2."), false);
  assert.equal(message.includes("3."), false);
  assert.equal(message.includes("这里不是问卷"), true);
});

test("pickFoundationNextFocus chooses the first missing high-value slot", () => {
  assert.equal(
    pickFoundationNextFocus({
      premise: "测试",
      mainline: "",
      storyHook: "",
      desiredTone: "",
      characterIdeas: [],
      worldviewIdeas: [],
      relationshipIdeas: [],
      unresolvedQuestions: [],
    }),
    "主线推进线",
  );

  assert.equal(
    pickFoundationNextFocus({
      premise: "测试",
      mainline: "主角崛起",
      storyHook: "",
      desiredTone: "",
      characterIdeas: [],
      worldviewIdeas: [],
      relationshipIdeas: [],
      unresolvedQuestions: [],
    }),
    "主角和关键配角",
  );
});

test("buildFoundationFallbackReply produces contextual free-form guidance", () => {
  const reply = buildFoundationFallbackReply({
    message: "主角的最强动机就是找到自己是谁，代价是每次说谎都会失忆。",
    draft: {
      premise: "测试",
      mainline: "",
      storyHook: "",
      desiredTone: "",
      characterIdeas: [],
      worldviewIdeas: [],
      relationshipIdeas: [],
      unresolvedQuestions: [],
    },
  });

  assert.equal(reply.includes("继续补三件事"), false);
  assert.equal(reply.includes("主角的最强动机"), true);
  assert.equal(reply.includes("固定问题"), false);
});
