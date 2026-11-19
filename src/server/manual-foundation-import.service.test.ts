import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const validFoundation = {
  premise: "林砚在雾港失物招领处追查被城市删除的失踪者。",
  mainline: "林砚必须在不牺牲陌生人的前提下终止四点十七分修正，并让姐姐回到公共记录。",
  storyHook: "一把无人认领的红伞传出失踪七年的姐姐的声音。",
  styleCard: "第三人称限知；具体动作承载悬疑信息；规则先显现代价再解释；禁止章末总结。",
  characters: [
    {
      name: "林砚",
      role: "protagonist",
      goal: "终止修正并对被删除者负责。",
      traits: ["谨慎", "重视可核验证据"],
      secrets: [],
    },
  ],
  worldview: [
    {
      name: "四点十七分修正",
      description: "雾港公共记录每天凌晨四点十七分自动改写一次。",
    },
  ],
  relationships: [],
};

test("manual foundation import persists the supplied foundation without an LLM dependency", async () => {
  const serviceModule = await import("./services/manual-foundation-import.service.ts").catch(() => null);
  assert.ok(serviceModule, "应提供人工设定导入服务");

  const calls: string[] = [];
  const service = serviceModule.createManualFoundationImportService({
    getProject: (projectId: string) => ({ id: projectId }),
    saveFoundation: (_projectId: string, foundation: typeof validFoundation) => {
      calls.push("save");
      return foundation;
    },
    syncConfirmedCards: () => calls.push("sync"),
    writeFoundationFiles: async () => {
      calls.push("write");
    },
    appendRunLog: () => calls.push("log"),
  });

  const result = await service.importFoundation("project-a", validFoundation);

  assert.equal(result.premise, validFoundation.premise);
  assert.deepEqual(calls, ["save", "sync", "write", "log"]);
});

test("manual foundation import rejects an unknown project before writing", async () => {
  const { createManualFoundationImportService } = await import("./services/manual-foundation-import.service.ts");
  let writes = 0;
  const service = createManualFoundationImportService({
    getProject: () => null,
    saveFoundation: (_projectId, foundation) => {
      writes += 1;
      return foundation;
    },
    syncConfirmedCards: () => {
      writes += 1;
    },
    writeFoundationFiles: async () => {
      writes += 1;
    },
    appendRunLog: () => {
      writes += 1;
    },
  });

  await assert.rejects(
    () => service.importFoundation("missing-project", validFoundation),
    /项目不存在/u,
  );
  assert.equal(writes, 0);
});

test("manual foundation import rejects placeholder residue before writing", async () => {
  const { createManualFoundationImportService } = await import("./services/manual-foundation-import.service.ts");
  let writes = 0;
  const service = createManualFoundationImportService({
    getProject: (projectId: string) => ({ id: projectId }),
    saveFoundation: (_projectId, foundation) => {
      writes += 1;
      return foundation;
    },
    syncConfirmedCards: () => {
      writes += 1;
    },
    writeFoundationFiles: async () => {
      writes += 1;
    },
    appendRunLog: () => {
      writes += 1;
    },
  });

  await assert.rejects(
    () => service.importFoundation("project-a", {
      ...validFoundation,
      characters: [{ name: "主角", role: "protagonist", goal: "继续冒险", traits: ["谨慎"] }],
    }),
    /placeholder 残留/u,
  );
  assert.equal(writes, 0);
});

test("manual foundation import payload schema accepts concrete input and rejects incomplete JSON", async () => {
  const validation = await import("./validation.ts");
  const schema = (validation as typeof validation & {
    manualFoundationImportSchema?: { safeParse(value: unknown): { success: boolean } };
  }).manualFoundationImportSchema;
  assert.ok(schema, "应提供人工设定导入载荷校验");

  assert.equal(schema.safeParse(validFoundation).success, true);
  assert.equal(schema.safeParse({ premise: validFoundation.premise }).success, false);
});

test("manual foundation import route validates JSON and calls the non-LLM import service", async () => {
  const routePath = new URL(
    "../app/api/projects/[projectId]/foundation/import/route.ts",
    import.meta.url,
  );
  const source = await readFile(routePath, "utf8").catch(() => "");

  assert.match(source, /manualFoundationImportSchema\.parse/u);
  assert.match(source, /importManualFoundation/u);
  assert.doesNotMatch(source, /chatJson|requestChat|Completion/u);
});
