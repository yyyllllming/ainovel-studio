import { z } from "zod";
import { PROJECT_AGENT_ROLES } from "./domain/agent-assignments.ts";
import {
  chapterPlanningModeValues,
  narrativePersonValues,
  paceProfileValues,
  seriesModeValues,
  storyLengthValues,
} from "./domain/project-structure.ts";

export const projectIdSchema = z
  .string()
  .trim()
  .min(1, "projectId 不能为空")
  .regex(/^[A-Za-z0-9_-]+$/, "projectId 不合法");

export const ideaIdSchema = projectIdSchema;
export const authorCardIdSchema = projectIdSchema;

export const chapterNoSchema = z.coerce.number().int().positive("chapterNo 必须是正整数");

export const agentAssignmentSchema = z.object({
  role: z.enum(PROJECT_AGENT_ROLES),
  profileId: z.string().trim().min(1, "profileId 不能为空"),
  model: z.string().trim().min(1, "model 不能为空"),
  temperature: z.number().finite().min(0).max(2),
  maxTokens: z.number().int().positive().max(200000),
});

function uniqueRoles(assignments: Array<z.infer<typeof agentAssignmentSchema>>, ctx: z.RefinementCtx) {
  const roles = assignments.map((assignment) => assignment.role);
  if (new Set(roles).size !== roles.length) {
    ctx.addIssue({
      code: "custom",
      message: "每个角色只能配置一次",
    });
  }
}

export const assignmentsSchema = z
  .array(agentAssignmentSchema)
  .min(4, "必须同时配置 coauthor / planner / writer / reviewer")
  .superRefine(uniqueRoles);

const reviewTriggerValues = [
  "opening_window",
  "mid_window",
  "cadence",
  "final_chapter",
  "completion_candidate",
  "manual_checkpoint",
  "hard_conflict",
  "low_confidence",
  "major_progression",
] as const;

export const reviewPolicySchema = z.object({
  cadenceChapters: z.coerce.number().int().min(1).max(200).optional(),
  deepReviewStartChapter: z.coerce.number().int().min(1).max(1000).optional(),
  perChapterCheckMode: z.enum(["minimal"]).optional().default("minimal"),
  forceTriggers: z.array(z.enum(reviewTriggerValues)).default([
    "hard_conflict",
    "low_confidence",
    "major_progression",
    "manual_checkpoint",
    "final_chapter",
    "completion_candidate",
  ]),
  manualCheckpointChapters: z.array(z.coerce.number().int().positive()).default([]),
});

const createProjectBaseSchema = z.object({
  title: z.string().trim().min(1, "标题不能为空").max(120),
  genre: z.string().trim().min(1, "题材不能为空").max(80),
  style: z.string().trim().min(1, "风格不能为空").max(80),
  seriesMode: z.enum(seriesModeValues),
  seriesTitle: z.string().trim().max(120).optional().default(""),
  seriesIndex: z.coerce.number().int().min(1).max(999).optional(),
  storyLength: z.enum(storyLengthValues),
  narrativePerson: z.enum(narrativePersonValues).optional().default("third"),
  hasVolumes: z.boolean().default(false),
  plannedVolumes: z.coerce.number().int().min(1).max(24).optional(),
  chapterPlanningMode: z.enum(chapterPlanningModeValues).optional(),
  paceProfile: z.enum(paceProfileValues).optional().default("medium"),
  completionCriteria: z.string().trim().max(2000).optional().default(""),
  chapterBudgetMin: z.coerce.number().int().min(1).max(200).optional(),
  chapterBudgetTarget: z.coerce.number().int().min(1).max(200).optional(),
  chapterBudgetMax: z.coerce.number().int().min(1).max(200).optional(),
  hardChapterCap: z.coerce.number().int().min(1).max(200).optional(),
  targetChapters: z.coerce.number().int().min(1).max(200).optional(),
  premise: z.string().trim().max(5000).default(""),
  assignments: assignmentsSchema,
  reviewPolicy: reviewPolicySchema.optional(),
});

export const createProjectSchema = createProjectBaseSchema.superRefine((input, ctx) => {
  const effectivePlanningMode =
    input.storyLength === "short"
      ? "fixed"
      : input.chapterPlanningMode ?? (input.targetChapters ? "fixed" : "dynamic");

  if (input.seriesMode === "series" && !input.seriesTitle.trim()) {
    ctx.addIssue({
      code: "custom",
      path: ["seriesTitle"],
      message: "系列作品必须填写系列名称",
    });
  }

  if (input.storyLength === "short" && input.hasVolumes) {
    ctx.addIssue({
      code: "custom",
      path: ["hasVolumes"],
      message: "短篇暂不支持分卷",
    });
  }

  if (input.storyLength !== "short" && input.hasVolumes && !input.plannedVolumes) {
    ctx.addIssue({
      code: "custom",
      path: ["plannedVolumes"],
      message: "分卷作品需要填写计划卷数",
    });
  }

  if (input.storyLength !== "short" && effectivePlanningMode === "fixed" && !input.targetChapters) {
    ctx.addIssue({
      code: "custom",
      path: ["targetChapters"],
      message: "固定章节模式必须填写章节数",
    });
  }

  if (input.storyLength !== "short" && effectivePlanningMode === "dynamic") {
    if (!input.plannedVolumes) {
      ctx.addIssue({
        code: "custom",
        path: ["plannedVolumes"],
        message: "动态模式需要填写计划卷数",
      });
    }
    if (!input.completionCriteria?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["completionCriteria"],
        message: "动态模式需要填写完结标准",
      });
    }
    if (!input.hardChapterCap) {
      ctx.addIssue({
        code: "custom",
        path: ["hardChapterCap"],
        message: "动态模式需要设置安全章节上限",
      });
    }
  }
});

export const createIdeaSchema = z.object({
  title: z.string().trim().max(120).optional().default(""),
});

export const updateIdeaSchema = z.object({
  title: z.string().trim().max(120).optional(),
  deleted: z.boolean().optional(),
}).refine(
  (payload) => payload.title !== undefined || payload.deleted !== undefined,
  { message: "至少提供一个可保存的想法字段", path: [] },
);

export const ideaWorkshopMessageSchema = z.object({
  message: z.string().trim().min(1, "消息不能为空").max(4000),
  baseUpdatedAt: z.string().trim().min(1).optional(),
  profileId: z.string().trim().min(1, "profileId 不能为空").optional(),
});

export const createProjectFromIdeaSchema = createProjectBaseSchema
  .omit({ style: true, premise: true })
  .extend({
    style: z.string().trim().min(1).max(80).optional().default("default"),
    premise: z.string().trim().max(5000).optional().default(""),
  })
  .superRefine((input, ctx) => {
    const effectivePlanningMode =
      input.storyLength === "short"
        ? "fixed"
        : input.chapterPlanningMode ?? (input.targetChapters ? "fixed" : "dynamic");

    if (input.seriesMode === "series" && !input.seriesTitle.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["seriesTitle"],
        message: "系列作品必须填写系列名称",
      });
    }

    if (input.storyLength === "short" && input.hasVolumes) {
      ctx.addIssue({
        code: "custom",
        path: ["hasVolumes"],
        message: "短篇暂不支持分卷",
      });
    }

    if (input.storyLength !== "short" && input.hasVolumes && !input.plannedVolumes) {
      ctx.addIssue({
        code: "custom",
        path: ["plannedVolumes"],
        message: "分卷作品需要填写计划卷数",
      });
    }

    if (input.storyLength !== "short" && effectivePlanningMode === "fixed" && !input.targetChapters) {
      ctx.addIssue({
        code: "custom",
        path: ["targetChapters"],
        message: "固定章节模式必须填写章节数",
      });
    }

    if (input.storyLength !== "short" && effectivePlanningMode === "dynamic") {
      if (!input.plannedVolumes) {
        ctx.addIssue({
          code: "custom",
          path: ["plannedVolumes"],
          message: "动态模式需要填写计划卷数",
        });
      }
      if (!input.completionCriteria?.trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["completionCriteria"],
          message: "动态模式需要填写完结标准",
        });
      }
      if (!input.hardChapterCap) {
        ctx.addIssue({
          code: "custom",
          path: ["hardChapterCap"],
          message: "动态模式需要设置安全章节上限",
        });
      }
    }
  });

export const assignmentsPayloadSchema = z.object({
  assignments: assignmentsSchema,
});

export const updateProjectSettingsSchema = z.object({
  reviewPolicy: reviewPolicySchema.optional(),
  narrativePerson: z.enum(narrativePersonValues).optional(),
}).refine(
  (payload) => payload.reviewPolicy !== undefined || payload.narrativePerson !== undefined,
  { message: "至少提供一个可保存的项目设置", path: [] },
);

export const blueprintUpdateSchema = z.object({
  sceneGoal: z.string().trim().min(1),
  characters: z.array(z.string().trim().min(1)).min(1),
  locations: z.array(z.string().trim().min(1)).min(1),
  conflicts: z.array(z.string().trim().min(1)).min(1),
  foreshadows: z.array(z.string().trim().min(1)).default([]),
  emotionalTone: z.string().trim().min(1),
  estimatedWords: z.number().int().positive(),
  segmentId: z.string().trim().min(1).nullable().optional(),
  segmentItemId: z.string().trim().min(1).nullable().optional(),
  requiredProgressDelta: z.enum([
    "situation_shift",
    "objective_shift",
    "information_shift",
    "relationship_shift",
    "power_shift",
    "world_shift",
    "cost_shift",
  ]).optional(),
});

export const optimizePayloadSchema = z
  .object({
    selection: z.object({
      start: z.number().int().nonnegative(),
      end: z.number().int().nonnegative(),
    }),
    action: z.enum(["polish", "expand", "rewrite", "enhance_emotion", "add_dialogue", "change_pov"]),
  })
  .superRefine((payload, ctx) => {
    if (payload.selection.end <= payload.selection.start) {
      ctx.addIssue({
        code: "custom",
        path: ["selection", "end"],
        message: "结束位置必须大于开始位置",
      });
    }
  });

export const editorPatchSchema = z.object({
  operations: z
    .array(
      z.object({
        type: z.enum(["replace", "insert", "delete"]),
        range: z
          .object({
            start: z.number().int().nonnegative(),
            end: z.number().int().nonnegative(),
          })
          .optional(),
        text: z.string().optional(),
      }),
    )
    .default([]),
  summary: z.string().default("Editor patch"),
});

export const applyPatchPayloadSchema = z
  .object({
    patchId: z.string().trim().min(1).optional(),
    patch: editorPatchSchema.optional(),
  })
  .superRefine((payload, ctx) => {
    if (!payload.patchId && !payload.patch) {
      ctx.addIssue({
        code: "custom",
        message: "必须提供 patchId 或 patch",
      });
    }
  });

export const rollbackPayloadSchema = z.object({
  versionId: z.string().trim().min(1, "versionId 不能为空"),
});

export const runStartPayloadSchema = z.object({
  fromChapter: chapterNoSchema.optional(),
});

export const deleteChapterRangePayloadSchema = z
  .object({
    startChapter: chapterNoSchema,
    endChapter: chapterNoSchema,
  })
  .superRefine((payload, ctx) => {
    if (payload.endChapter < payload.startChapter) {
      ctx.addIssue({
        code: "custom",
        path: ["endChapter"],
        message: "结束章节必须大于或等于开始章节",
      });
    }
  });

export const foundationWorkshopMessageSchema = z.object({
  message: z.string().trim().min(1, "消息不能为空").max(4000),
  resumeSessionId: z.string().trim().min(1).nullable().optional(),
});

const manualFoundationCharacterSchema = z.object({
  name: z.string().trim().min(1, "角色姓名不能为空").max(120),
  role: z.string().trim().min(1, "角色定位不能为空").max(120),
  goal: z.string().trim().min(1, "角色目标不能为空").max(2000),
  traits: z.array(z.string().trim().min(1).max(200)).min(1).max(40),
  secrets: z.array(z.string().trim().min(1).max(1000)).max(40).optional(),
}).strict();

const manualFoundationWorldRuleSchema = z.object({
  name: z.string().trim().min(1, "世界规则名称不能为空").max(160),
  description: z.string().trim().min(1, "世界规则说明不能为空").max(4000),
}).strict();

const manualFoundationRelationshipSchema = z.object({
  source: z.string().trim().min(1).max(120),
  target: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(1000),
}).strict();

export const manualFoundationImportSchema = z.object({
  premise: z.string().trim().min(20, "故事前提至少需要 20 个字符").max(10000),
  mainline: z.string().trim().min(20, "主线至少需要 20 个字符").max(10000),
  storyHook: z.string().trim().min(10, "故事钩子至少需要 10 个字符").max(5000),
  styleCard: z.string().trim().min(20, "文风约束至少需要 20 个字符").max(10000),
  characters: z.array(manualFoundationCharacterSchema).min(1, "至少需要一个实名角色").max(200),
  worldview: z.array(manualFoundationWorldRuleSchema).min(1, "至少需要一条具体世界规则").max(200),
  relationships: z.array(manualFoundationRelationshipSchema).max(500).default([]),
}).strict();

export const foundationStructuredSuggestionActionSchema = z
  .object({
    action: z.enum(["generate", "refresh", "apply", "dismiss"]),
    suggestionId: z.string().trim().min(1).optional(),
  })
  .superRefine((payload, ctx) => {
    if ((payload.action === "apply" || payload.action === "dismiss") && !payload.suggestionId) {
      ctx.addIssue({
        code: "custom",
        path: ["suggestionId"],
        message: "该操作必须提供 suggestionId",
      });
    }
  });

export const foundationStyleSearchQuerySchema = z.object({
  query: z.string().trim().min(1, "查询不能为空").max(120),
});

export const foundationStyleSteeringSchema = z.object({
  references: z
    .array(
      z.object({
        kind: z.enum(["book", "author"]),
        label: z.string().trim().min(1).max(160),
        author: z.string().trim().max(160).optional(),
        source: z.enum(["network", "ai_fallback"]),
        relation: z.enum(["primary", "secondary"]),
      }),
    )
    .min(1, "至少选择一个参考")
    .max(3, "最多选择三个参考"),
  samples: z
    .array(z.string().trim().min(1).max(1200))
    .max(3, "最多提供 3 段样本文本")
    .optional()
    .default([]),
  manualGuidance: z.string().trim().max(1200).optional().default(""),
  avoidances: z.string().trim().max(1200).optional().default(""),
}).superRefine((input, ctx) => {
  const primaryCount = input.references.filter((item) => item.relation === "primary").length;
  const secondaryCount = input.references.filter((item) => item.relation === "secondary").length;
  if (primaryCount !== 1) {
    ctx.addIssue({
      code: "custom",
      path: ["references"],
      message: "必须选择 1 个主参考",
    });
  }
  if (secondaryCount > 2) {
    ctx.addIssue({
      code: "custom",
      path: ["references"],
      message: "最多选择 2 个辅参考",
    });
  }
});

export const foundationStyleSnapshotCreateSchema = z.object({
  mode: z.enum(["book", "author"]),
  sourceIds: z.array(z.string().trim().min(1)).min(1, "至少选择一个导入源"),
});

export const createAuthorCardSchema = z.object({
  action: z.literal("create"),
  displayName: z.string().trim().min(1, "作者名不能为空").max(160),
});

export const authorCardSyncSchema = z.object({
  snapshotId: z.string().trim().min(1, "snapshotId 不能为空"),
  authorName: z.string().trim().min(1, "作者名不能为空").max(160),
  conflictResolution: z.enum(["auto", "merge_existing", "create_independent", "cancel"]).default("auto"),
  existingCardId: z.string().trim().min(1).optional(),
});

export const authorCardRegisterSchema = authorCardSyncSchema.extend({
  projectId: projectIdSchema,
});

export const authorImportSchema = z.object({
  title: z.string().trim().max(160).optional(),
  author: z.string().trim().max(160).optional(),
});

export const authorBookImportPreviewSchema = authorImportSchema.extend({
  encoding: z.string().trim().max(40).optional(),
});

export const deleteAuthorImportSchema = z.object({
  importId: z.string().trim().min(1, "importId 不能为空"),
});

export const applyAuthorBookImportSchema = z.object({
  previewId: z.string().trim().min(1, "previewId 不能为空"),
});

export const generateBookCardSchema = z.object({
  importIds: z.array(z.string().trim().min(1)).min(1, "至少选择一份导入文本"),
});

export const mergeAuthorStyleSchema = z.object({});

export const applyBookCardSchema = z.object({
  projectId: projectIdSchema,
});

export const steeringNotePayloadSchema = z.object({
  instruction: z.string().trim().min(1, "指令不能为空").max(2000),
  scope: z.enum(["next_arc", "current_volume", "persistent"]).optional().default("next_arc"),
});

export const manualReviewActionSchema = z.object({
  action: z.enum(["approve_continue", "retry_chapter", "auto_pick_version"]),
});

const AUTHOR_SUBMISSION_MAX_BYTES = 32 * 1024 * 1024;
const authorSubmissionSourceSchema = z.enum(["human", "codex", "import"]);
const authorSubmissionEncodingSchema = z.enum(["utf-8", "utf-8-sig", "gb18030", "gbk", "big5"]);
const authorSubmissionTitleSchema = z.string().trim().min(1, "作者稿标题不能为空").max(200, "作者稿标题不得超过 200 个字符");
const authorSubmissionContentSchema = z.string().min(1, "作者稿正文不能为空").superRefine((content, ctx) => {
  if (!content.trim()) {
    ctx.addIssue({ code: "custom", message: "作者稿正文不能为空" });
  }
  if (Buffer.byteLength(content, "utf8") > AUTHOR_SUBMISSION_MAX_BYTES) {
    ctx.addIssue({ code: "custom", message: "作者稿正文不得超过 32MB" });
  }
});

export const authorSubmissionSinglePreviewMetadataSchema = z.object({
  kind: z.literal("single"),
  chapterNo: chapterNoSchema,
  title: authorSubmissionTitleSchema,
  source: authorSubmissionSourceSchema.optional().default("human"),
});

export const authorSubmissionSinglePreviewInputSchema = authorSubmissionSinglePreviewMetadataSchema.extend({
  content: authorSubmissionContentSchema,
});

export const authorSubmissionMultiPreviewMetadataSchema = z.object({
  kind: z.literal("multi"),
  fileName: z.string().trim().min(1, "文件名不能为空").max(255, "文件名过长"),
  startChapterNo: chapterNoSchema,
  encoding: authorSubmissionEncodingSchema.optional(),
  source: authorSubmissionSourceSchema.optional().default("import"),
});

export const authorSubmissionPreviewInputSchema = z.discriminatedUnion("kind", [
  authorSubmissionSinglePreviewInputSchema,
  authorSubmissionMultiPreviewMetadataSchema.extend({
    buffer: z.custom<Buffer>(Buffer.isBuffer, "作者稿文件无效").superRefine((buffer, ctx) => {
      if (buffer.length === 0) {
        ctx.addIssue({ code: "custom", message: "作者稿文件不能为空" });
      }
      if (buffer.length > AUTHOR_SUBMISSION_MAX_BYTES) {
        ctx.addIssue({ code: "custom", message: "作者稿文件不得超过 32MB" });
      }
    }),
  }),
]);

export const authorSubmissionImportInputSchema = z.object({
  previewId: z.string().regex(/^[A-Za-z0-9_-]+$/u, "previewId 预览标识不合法"),
}).strict();

export const reviseAuthorSubmissionInputSchema = z.object({
  title: authorSubmissionTitleSchema,
  content: authorSubmissionContentSchema,
  source: authorSubmissionSourceSchema.optional().default("human"),
}).strict();

export const submissionFiltersSchema = z.object({
  batchId: z.string().trim().min(1).max(128).optional(),
  chapterNo: chapterNoSchema.optional(),
  source: authorSubmissionSourceSchema.optional(),
  status: z.enum(["draft", "queued", "reviewing", "needs_revision", "approved", "committed", "failed"]).optional(),
}).strict();

export const submissionIdSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/u, "submissionId 不合法");

export const reviewAuthorSubmissionInputSchema = z.object({}).strict();

export const approveAuthorSubmissionInputSchema = z.object({
  humanOverride: z.boolean().optional().default(false),
  overrideReason: z.string().trim().min(1).max(1000).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.humanOverride && !value.overrideReason) {
    ctx.addIssue({ code: "custom", path: ["overrideReason"], message: "人工覆盖必须填写原因" });
  }
});

export const createCardSchema = z.object({
  cardType: z.enum(["character", "world"]),
  name: z.string().trim().min(1, "卡片名称不能为空").max(120),
  draft: z.record(z.string(), z.unknown()).optional(),
  meta: z
    .object({
      aliases: z.array(z.string().trim().min(1)).default([]),
      keywords: z.array(z.string().trim().min(1)).default([]),
      priority: z.coerce.number().int().min(0).max(200).default(50),
      pinnedScope: z.enum(["none", "global", "chapter"]).default("none"),
      linkedCardIds: z.array(z.string().trim().min(1)).default([]),
      enabled: z.boolean().default(true),
    })
    .optional(),
});

export const updateCardSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  draft: z.record(z.string(), z.unknown()).optional(),
  meta: z
    .object({
      aliases: z.array(z.string().trim().min(1)).default([]),
      keywords: z.array(z.string().trim().min(1)).default([]),
      priority: z.coerce.number().int().min(0).max(200).default(50),
      pinnedScope: z.enum(["none", "global", "chapter"]).default("none"),
      linkedCardIds: z.array(z.string().trim().min(1)).default([]),
      enabled: z.boolean().default(true),
    })
    .optional(),
}).refine(
  (d) => d.name !== undefined || d.draft !== undefined || d.meta !== undefined,
  { message: "name / draft / meta 至少提供一个", path: [] },
);

export const cardWorkshopMessageSchema = z.object({
  message: z.string().trim().min(1, "消息不能为空").max(4000),
});

export const cardConfirmActionSchema = z.object({
  action: z.enum(["confirm", "unconfirm"]),
});
