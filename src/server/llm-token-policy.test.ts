import test from "node:test";
import assert from "node:assert/strict";

import {
  AUTHOR_CARD_MAX_TOKEN_CANDIDATES,
  WORKFLOW_TOKEN_CAPS,
  capByAssignment,
  resolveOutputPolicy,
  runWithTokenCandidates,
} from "./llm-token-policy.ts";

test("author-card token ladder uses the conservative extended retry candidates", () => {
  assert.deepEqual(AUTHOR_CARD_MAX_TOKEN_CANDIDATES, [5120, 4096, 3072]);
});

test("capByAssignment always respects the smaller of assignment ceiling and workflow budget", () => {
  assert.equal(capByAssignment(4096, WORKFLOW_TOKEN_CAPS.foundationWorkshop.workshopReply), 2200);
  assert.equal(capByAssignment(1500, WORKFLOW_TOKEN_CAPS.foundationWorkshop.workshopReply), 1500);
});

test("structured workflow budgets stay local and writer-sized ceilings do not change them", () => {
  assert.equal(WORKFLOW_TOKEN_CAPS.chapterAudit.quickAudit, 1400);
  assert.equal(WORKFLOW_TOKEN_CAPS.blueprintPlanner.candidate, 2600);
  assert.equal(capByAssignment(8192, WORKFLOW_TOKEN_CAPS.chapterAudit.quickAudit), 1400);
});

test("resolveOutputPolicy keeps foundation workshop visible streams on the shared long-form prose budget", () => {
  const shortPrompt = resolveOutputPolicy({
    workflow: "foundation_workshop_stream_reply",
    promptTokens: 320,
    assignmentMaxTokens: 4096,
  });
  const longPrompt = resolveOutputPolicy({
    workflow: "foundation_workshop_stream_reply",
    promptTokens: 6200,
    assignmentMaxTokens: 4096,
  });

  assert.equal(shortPrompt.softTarget, 2500);
  assert.equal(longPrompt.softTarget, 2500);
  assert.equal(shortPrompt.hardCap, 4096);
  assert.equal(shortPrompt.continuationMode, "visible_long_stream");
  assert.equal(shortPrompt.alwaysContinueToSentence, true);
  assert.deepEqual(shortPrompt.candidateLadder, [2500, 2200, 1900]);
});

test("resolveOutputPolicy derives dynamic ladders for long-form generation workflows", () => {
  const policy = resolveOutputPolicy({
    workflow: "chapter_draft_stream",
    promptTokens: 2400,
    assignmentMaxTokens: 8192,
    targetWords: 3000,
  });

  assert.equal(policy.continuationMode, "visible_long_stream");
  assert.equal(policy.alwaysContinueToSentence, true);
  assert.equal(policy.workflowMin, 2200);
  assert.equal(policy.softTarget, 4200);
  assert.equal(policy.hardCap, 6000);
  assert.deepEqual(policy.candidateLadder, [4200, 3900, 3600]);
});

test("resolveOutputPolicy keeps idea workshop stream replies on a long-form continuation budget", () => {
  const policy = resolveOutputPolicy({
    workflow: "idea_workshop_stream_reply",
    promptTokens: 2800,
    assignmentMaxTokens: 8192,
  });

  assert.equal(policy.continuationMode, "visible_long_stream");
  assert.equal(policy.alwaysContinueToSentence, true);
  assert.equal(policy.workflowMin, 1800);
  assert.equal(policy.softTarget, 2500);
  assert.equal(policy.hardCap, 4200);
  assert.deepEqual(policy.candidateLadder, [2500, 2200, 1900]);
});

test("resolveOutputPolicy falls back to the hard cap when assignment ceilings squeeze below workflow minima", () => {
  const policy = resolveOutputPolicy({
    workflow: "rewrite_from_review",
    promptTokens: 9000,
    assignmentMaxTokens: 1200,
  });

  assert.equal(policy.hardCap, 1200);
  assert.deepEqual(policy.candidateLadder, [1200]);
});

test("runWithTokenCandidates retries retryable failures and stops at the first success", async () => {
  const attempts: number[] = [];

  const result = await runWithTokenCandidates(
    [1500, 1200, 900],
    async (maxTokens) => {
      attempts.push(maxTokens);
      if (maxTokens !== 1200) {
        throw new Error("(400) max_tokens too large");
      }
      return "ok";
    },
    (error) => error instanceof Error && /max_tokens/i.test(error.message),
  );

  assert.equal(result, "ok");
  assert.deepEqual(attempts, [1500, 1200]);
});
