# Author Mode and Review Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class Author Submission workflow that never calls the Writer, repair the review/continuity P0 defects that would invalidate an 80-chapter test, and expose the complete workflow through an accessible UI and live E2E tests.

**Architecture:** Author Submissions are immutable candidate manuscripts backed by SQLite state and project-local files. Approval creates a normal `chapter_versions` record and uses the existing Chapter Commit + Artifact Outbox path; there is no second final-chapter system. Review lineage binds every report to a submission/version/content hash. Mandatory review scheduling, artifact barriers, deterministic cross-chapter checks, partial Canon success, and re-entrant invalidation are shared by automatic and author workflows.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Zod, SQLite/better-sqlite3, Drizzle, TanStack Query/Virtual, Node test runner, Vitest, Playwright.

**Execution note:** The approved Fable5 baseline includes user-owned uncommitted changes in the current worktree. Execute here, inspect overlapping diffs before every edit, stage only task-specific files, and never reset or overwrite unrelated work.

---

## File Map

### Create

- `migrations/0015_author_submissions.sql`
- `migrations/meta/0015_snapshot.json`
- `src/server/types/author-submission.ts`
- `src/server/files/author-submission-files.ts`
- `src/server/repositories/chapter-submission.repository.ts`
- `src/server/services/author-submission.service.ts`
- `src/server/writing/cross-chapter-audit.ts`
- `src/server/run/chapter-prerequisites.ts`
- `src/lib/types/author-submission.ts`
- `src/components/project/use-author-submission-queries.ts`
- `src/components/author-submissions-client.tsx`
- `src/app/api/projects/[projectId]/author-submissions/route.ts`
- `src/app/api/projects/[projectId]/author-submissions/preview/route.ts`
- `src/app/api/projects/[projectId]/author-submissions/import/route.ts`
- `src/app/api/projects/[projectId]/author-submissions/[submissionId]/review/route.ts`
- `src/app/api/projects/[projectId]/author-submissions/[submissionId]/approve/route.ts`
- `src/app/api/projects/[projectId]/author-submissions/[submissionId]/revise/route.ts`
- `src/server/chapter-submission.repository.test.ts`
- `src/server/author-submission.service.test.ts`
- `src/server/author-submission.integration.test.ts`
- `src/server/cross-chapter-audit.test.ts`
- `src/server/run/chapter-prerequisites.test.ts`
- `src/components/__tests__/author-submissions-client.test.tsx`
- `e2e/helpers/project.ts`
- `e2e/helpers/author-mode.ts`
- `e2e/helpers/download.ts`
- `e2e/fixtures/author-submissions-4-chapters.md`
- `e2e/04-author-submission-flow.spec.ts`
- `e2e/05-manuscript-export-flow.spec.ts`
- `e2e/06-responsive-a11y.spec.ts`
- `scripts/start-e2e-stack.mjs`
- `scripts/verify-author-mode-run.mjs`

### Modify

- `src/server/db/schema.ts`
- `migrations/meta/_journal.json`
- `src/server/db/migration-runner.test.ts`
- `src/server/types.ts`
- `src/server/types/review.ts`
- `src/server/types/story.ts`
- `src/server/repositories/shared.ts`
- `src/server/repositories/review.repository.ts`
- `src/server/project-files.ts`
- `src/server/validation.ts`
- `src/server/run/chapter-audit.ts`
- `src/server/run/chapter-review.ts`
- `src/server/run/chapter-runner.ts`
- `src/server/run/chapter-finalize.ts`
- `src/server/run/run-decisions.ts`
- `src/server/run/review-policy.ts`
- `src/server/run/context-engine.ts`
- `src/server/services/context-serialization.ts`
- `src/server/services/chapter-query.service.ts`
- `src/server/story/canon.ts`
- `src/server/commit/chapter-artifact-sync.ts`
- `src/server/commit/chapter-commit.service.ts`
- `src/server/commit/apply-stored-patch.service.ts`
- `src/server/commit/rollback-version.service.ts`
- `src/server/services/run-restart.service.ts`
- `src/lib/types/chapter.ts`
- `src/lib/types/index.ts`
- `src/components/project/use-project-queries.ts`
- `src/components/project/use-project-detail-controller.tsx`
- `src/components/project-detail-client.tsx`
- `src/components/chapter-workshop-client.tsx`
- `src/components/dashboard/project-creation-form.tsx`
- `src/components/confirm-dialog.tsx`
- `playwright.config.ts`
- `package.json`
- `e2e/01-project-creation-flow.spec.ts`
- `e2e/02-chapter-writing-flow.spec.ts`
- `e2e/03-version-management-flow.spec.ts`

---

### Task 1: Freeze the Baseline and Add the Submission Schema

**Files:**
- Modify: `src/server/db/schema.ts`
- Create: `migrations/0015_author_submissions.sql`
- Create: `migrations/meta/0015_snapshot.json`
- Modify: `migrations/meta/_journal.json`
- Modify: `src/server/db/migration-runner.test.ts`

- [ ] **Step 1: Record the pre-change verification result**

Run:

```powershell
pnpm typecheck
pnpm test
pnpm test:ui
git status --short
```

Expected: preserve the exact pass/fail baseline in the task notes; do not fix unrelated failures.

- [ ] **Step 2: Write the failing migration test**

Add to `src/server/db/migration-runner.test.ts`:

```ts
test("latest schema contains author submissions and review lineage", () => {
  const db = new Database(":memory:");
  try {
    runMigrations(db, migrations);
    assert.equal(hasTable(db, "chapter_submission_batches"), true);
    assert.equal(hasTable(db, "chapter_submissions"), true);
    const columns = db.prepare("PRAGMA table_info(review_reports)").all() as Array<{ name: string }>;
    const names = new Set(columns.map((column) => column.name));
    for (const name of ["submission_id", "version_id", "content_hash", "reviewer_profile_id", "prompt_hash", "review_schema_version"]) {
      assert.equal(names.has(name), true, `missing review_reports.${name}`);
    }
  } finally {
    db.close();
  }
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test -- src/server/db/migration-runner.test.ts`
Expected: FAIL because the new tables and columns do not exist.

- [ ] **Step 4: Add the Drizzle tables and lineage columns**

Add table definitions with these exact constraints:

```ts
export const chapterSubmissionBatches = sqliteTable("chapter_submission_batches", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  sourceFileName: text("source_file_name").notNull(),
  sourceFileHash: text("source_file_hash").notNull(),
  chapterCount: integer("chapter_count").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => ({
  identityIdx: uniqueIndex("idx_submission_batches_identity").on(table.projectId, table.sourceFileHash),
  statusCheck: check("chapter_submission_batches_status_check", sql`${table.status} IN ('preview','importing','completed','partial_failed','failed')`),
}));

export const chapterSubmissions = sqliteTable("chapter_submissions", {
  id: text("id").primaryKey(),
  batchId: text("batch_id"),
  projectId: text("project_id").notNull(),
  chapterNo: integer("chapter_no").notNull(),
  title: text("title").notNull(),
  source: text("source").notNull(),
  contentPath: text("content_path").notNull(),
  contentHash: text("content_hash").notNull(),
  status: text("status").notNull(),
  parentSubmissionId: text("parent_submission_id"),
  committedVersionId: text("committed_version_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => ({
  identityIdx: uniqueIndex("idx_chapter_submissions_identity").on(table.projectId, table.chapterNo, table.contentHash),
  batchIdx: index("idx_chapter_submissions_batch").on(table.batchId),
  parentIdx: index("idx_chapter_submissions_parent").on(table.parentSubmissionId),
  statusCheck: check("chapter_submissions_status_check", sql`${table.status} IN ('draft','queued','reviewing','needs_revision','approved','committed','failed')`),
  sourceCheck: check("chapter_submissions_source_check", sql`${table.source} IN ('human','codex','import')`),
}));
```

Extend `reviewReports` with nullable lineage fields. Run `pnpm db:generate` and verify the generated SQL/meta before accepting it.

- [ ] **Step 5: Run migration tests and commit**

Run: `pnpm test -- src/server/db/migration-runner.test.ts`
Expected: PASS.

```powershell
git add src/server/db/schema.ts migrations src/server/db/migration-runner.test.ts
git commit -m "feat(author-mode): add submission schema and review lineage"
```

### Task 2: Add Submission Types, Repository, and State Machine

**Files:**
- Create: `src/server/types/author-submission.ts`
- Create: `src/server/repositories/chapter-submission.repository.ts`
- Create: `src/server/chapter-submission.repository.test.ts`
- Modify: `src/server/types.ts`

- [ ] **Step 1: Write failing repository tests**

Cover content identity, valid transitions, invalid rollback, revisions, partial batch status, and commit attachment. Use this transition table:

```ts
const ALLOWED_TRANSITIONS = {
  draft: ["queued", "failed"],
  queued: ["reviewing", "failed"],
  reviewing: ["needs_revision", "approved", "failed"],
  needs_revision: ["queued", "failed"],
  approved: ["committed", "failed"],
  committed: [],
  failed: ["queued"],
} as const;
```

`approved → committed` remains a valid domain edge, but it is the one specialized edge: tests must execute it through `attachCommittedVersion(id, versionId)`, which validates a real Version from the same project/chapter and atomically writes both status and `committedVersionId`. The generic two-argument `transition` method must reject `next === "committed"`; it handles every other edge in the table. New submissions always start at `draft`.

Test identity explicitly:

```ts
test("createOrGet returns the same submission for project, chapter and hash", () => {
  const first = repository.createOrGet(fixture({ contentHash: "sha256-a" }));
  const second = repository.createOrGet(fixture({ contentHash: "sha256-a" }));
  assert.equal(second.id, first.id);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- src/server/chapter-submission.repository.test.ts`
Expected: FAIL because the repository does not exist.

- [ ] **Step 3: Implement the repository API**

Export exactly:

```ts
export function createChapterSubmissionRepository(input?: { db?: Database.Database }) {
  return {
    createOrGet(record: NewChapterSubmission): ChapterSubmissionRecord,
    getById(id: string): ChapterSubmissionRecord | null,
    listByProject(projectId: string, filters?: SubmissionFilters): ChapterSubmissionListItem[],
    transition(id: string, next: ChapterSubmissionStatus): ChapterSubmissionRecord,
    createRevision(input: CreateSubmissionRevisionInput): ChapterSubmissionRecord,
    attachCommittedVersion(id: string, versionId: string): ChapterSubmissionRecord,
    createOrGetBatch(input: NewSubmissionBatch): ChapterSubmissionBatchRecord,
    setBatchStatus(id: string, status: ChapterSubmissionBatchStatus): ChapterSubmissionBatchRecord,
  };
}
```

Every transition must use `UPDATE ... WHERE status = ?`; a zero-row update throws `conflict("作者稿状态已变化")`.

Before insert/replay, validate Batch and Parent Submission ownership. An identity replay may return the existing record only when immutable lineage metadata is compatible. `attachCommittedVersion` must reject missing or cross-project/cross-chapter Versions. Batch joins must include project ownership so legacy invalid rows cannot expose another project's metadata.

- [ ] **Step 4: Verify and commit**

Run: `pnpm test -- src/server/chapter-submission.repository.test.ts`
Expected: PASS.

```powershell
git add src/server/types/author-submission.ts src/server/repositories/chapter-submission.repository.ts src/server/chapter-submission.repository.test.ts src/server/types.ts
git commit -m "feat(author-mode): add submission repository state machine"
```

### Task 3: Add Safe Preview and Immutable Submission Files

**Files:**
- Create: `src/server/files/author-submission-files.ts`
- Modify: `src/server/project-files.ts`
- Modify: `src/server/author-book-import-parser.ts`
- Modify: `src/server/author-book-import-parser.test.ts`
- Create: `src/server/author-submission.service.test.ts`

- [ ] **Step 1: Add failing parser/file tests**

Tests must cover: UTF-8 Markdown, Chinese heading numbers, 80 chapters, duplicate chapter warnings, a single pasted chapter, and a path traversal file name.

Duplicate chapter-number coverage must normalize Arabic and Chinese numerals from the heading (`第7章` and `第七章`) even when the remaining titles differ. It must not substitute a duplicate-title warning or guess volume/special/out-of-range headings.

```ts
test("single pasted chapter remains one submission", () => {
  const result = buildSingleSubmissionPreview({ chapterNo: 7, title: "雨夜遗物", content: "正文".repeat(1200) });
  assert.equal(result.chapters.length, 1);
  assert.equal(result.chapters[0]?.chapterNo, 7);
});
```

- [ ] **Step 2: Verify failure**

Run: `pnpm test -- src/server/author-book-import-parser.test.ts src/server/author-submission.service.test.ts`
Expected: FAIL on missing author submission helpers.

- [ ] **Step 3: Implement file paths and staging promotion**

Export:

```ts
export function authorSubmissionPreviewDir(projectId: string, previewId: string) {
  return withinProject(projectId, ".staging", "author-submissions", previewId);
}

export function authorSubmissionContentPath(projectId: string, chapterNo: number, contentHash: string) {
  const chapter = String(chapterNo).padStart(3, "0");
  return withinProject(projectId, "author-submissions", `chapter_${chapter}_${contentHash.slice(0, 12)}.md`);
}

export async function promoteAuthorSubmission(input: {
  projectId: string;
  previewPath: string;
  chapterNo: number;
  contentHash: string;
}) {
  const target = authorSubmissionContentPath(input.projectId, input.chapterNo, input.contentHash);
  await mkdir(dirname(target), { recursive: true });
  await rename(input.previewPath, target);
  return target;
}
```

Extend `ensureProjectLayout()` with `author-submissions` and `.staging/author-submissions`.

On Windows, `rename` may replace an existing target, so promotion must publish through an atomic no-replace primitive. Read and hash a stable source snapshot, write/fsync a same-directory temporary file, publish exclusively, verify the final hash, and clean temporary publish files. Node does not expose an `unlinkat`-style operation bound to the verified source handle, so promotion intentionally retains the staging preview; expiry cleanup owns later staging deletion. If the staging path changes after the snapshot is read, publish only the verified snapshot and never delete the changed path.

Post-open boundary validation prevents manuscript bytes from being written through a directory that changed ownership. With Node's path-based APIs, a same-user concurrent junction replacement can still cause the exclusive `open("wx")` itself to create an empty random-name temporary file outside the project before the post-open check rejects it. Tests must prove that artifact is zero bytes and that no target manuscript is created; eliminating even that empty-file side effect requires a future native directory-handle/openat implementation.

- [ ] **Step 4: Verify and commit**

Run: `pnpm test -- src/server/author-book-import-parser.test.ts src/server/author-submission.service.test.ts`
Expected: PASS.

```powershell
git add src/server/files/author-submission-files.ts src/server/project-files.ts src/server/author-book-import-parser.test.ts src/server/author-submission.service.test.ts
git commit -m "feat(author-mode): add safe manuscript preview storage"
```

### Task 4: Implement Preview, Import, List, and Revision Services

**Files:**
- Create: `src/server/services/author-submission.service.ts`
- Modify: `src/server/validation.ts`
- Modify: `src/server/author-submission.service.test.ts`

- [ ] **Step 1: Write failing service tests**

Assert preview writes no Submission rows; import is per-chapter and partially successful; duplicate import is idempotent; revision links to the parent; an open Writer session still permits draft import; and no Writer dependency exists.

- [ ] **Step 2: Verify failure**

Run: `pnpm test -- src/server/author-submission.service.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the public service surface**

```ts
export function createAuthorSubmissionService(deps?: Partial<AuthorSubmissionDependencies>) {
  return {
    preview: (projectId: string, input: AuthorSubmissionPreviewInput) => previewAuthorSubmissions(projectId, input, deps),
    importPreview: (projectId: string, input: AuthorSubmissionImportInput) => importAuthorSubmissions(projectId, input, deps),
    list: (projectId: string, filters?: SubmissionFilters) => repository.listByProject(projectId, filters),
    revise: (projectId: string, submissionId: string, input: ReviseAuthorSubmissionInput) => reviseAuthorSubmission(projectId, submissionId, input, deps),
  };
}
```

Use `parseAuthorBookImportBuffer()` only for multi-chapter input. Resolve heading chapter numbers in the service; if absent, use `startChapterNo + index`. Preview never inserts DB rows.

- [ ] **Step 4: Verify and commit**

Run: `pnpm test -- src/server/author-submission.service.test.ts`
Expected: PASS.

```powershell
git add src/server/services/author-submission.service.ts src/server/validation.ts src/server/author-submission.service.test.ts
git commit -m "feat(author-mode): add manuscript import services"
```

### Task 5: Bind Review Reports to Exact Content

**Files:**
- Modify: `src/server/types/review.ts`
- Modify: `src/server/repositories/shared.ts`
- Modify: `src/server/repositories/review.repository.ts`
- Modify: `src/server/project-files.ts`
- Modify: `src/server/run/chapter-audit.ts`
- Modify: `src/server/run/chapter-review.ts`
- Modify: `src/server/services/chapter-query.service.ts`
- Modify: `src/lib/types/chapter.ts`
- Modify: `src/server/review-artifact.test.ts`
- Create: `src/server/review-repository.test.ts`

- [ ] **Step 1: Write failing lineage tests**

```ts
const lineage = {
  submissionId: "submission-1",
  versionId: null,
  contentHash: "sha256-current",
  reviewerProfileId: "reviewer-profile",
  promptHash: "sha256-prompt",
  reviewSchemaVersion: "author-submission-v1",
};

test("reports for another content hash are stale", () => {
  saveReviewReport(projectId, 1, verdict, reviewPath, null, lineage);
  const reports = listReviewReports(projectId, 1, { currentContentHash: "sha256-new" });
  assert.equal(reports[0]?.stale, true);
});
```

- [ ] **Step 2: Verify failure**

Run: `pnpm test -- src/server/review-artifact.test.ts src/server/review-repository.test.ts`
Expected: FAIL because lineage is unsupported.

- [ ] **Step 3: Extend the save/query contract**

Use this signature:

```ts
export interface ReviewLineage {
  submissionId: string | null;
  versionId: string | null;
  contentHash: string;
  reviewerProfileId: string;
  promptHash: string;
  reviewSchemaVersion: string;
}

export type SaveReviewReport = (
  projectId: string,
  chapterNo: number,
  review: QuickAuditVerdict | ReviewVerdict,
  path: string,
  plannerQuality: PlannerQualitySummary | null,
  lineage: ReviewLineage,
) => string;
```

Implement `saveReviewReport` so it inserts the lineage fields and returns the persisted report ID. `listReviewReports(..., { currentContentHash })` computes `stale = !contentHash || contentHash !== currentContentHash`. Current UI and decisions must ignore stale reports.

- [ ] **Step 4: Verify and commit**

Run: `pnpm test -- src/server/review-artifact.test.ts src/server/review-repository.test.ts src/server/chapter-query.service.test.ts`
Expected: PASS.

```powershell
git add src/server/types/review.ts src/server/repositories/shared.ts src/server/repositories/review.repository.ts src/server/project-files.ts src/server/run/chapter-audit.ts src/server/run/chapter-review.ts src/server/services/chapter-query.service.ts src/lib/types/chapter.ts src/server/review-artifact.test.ts src/server/review-repository.test.ts
git commit -m "fix(review): bind reports to exact manuscript content"
```

### Task 6: Make Mandatory Deep Review Independent of the Quick Gate

**Files:**
- Modify: `src/server/run/review-policy.ts`
- Modify: `src/server/run/run-decisions.ts`
- Modify: `src/server/run/chapter-runner.ts`
- Modify: `src/server/review-policy.test.ts`
- Modify: `src/server/run-decisions.test.ts`

- [ ] **Step 1: Add failing opening/mid/cadence tests**

```ts
for (const chapterNo of [1, 2, 3, 4, 5, 6, 8, 10, 12]) {
  test(`chapter ${chapterNo} cannot bypass mandatory deep review`, () => {
    const mandatory = decideMandatoryDeepReview({ chapterNo, totalChapters: 80, policy, isCompletionCandidate: false });
    assert.equal(mandatory.shouldDeepReview, true);
  });
}
```

- [ ] **Step 2: Verify failure**

Run: `pnpm test -- src/server/review-policy.test.ts src/server/run-decisions.test.ts`
Expected: FAIL for chapters currently bypassed by `shouldInvokeQuickAudit`.

- [ ] **Step 3: Implement mandatory decision first**

```ts
export function decideMandatoryDeepReview(input: MandatoryDeepReviewInput) {
  const reasons = new Set<ReviewTriggerReason>();
  if (input.chapterNo <= 6) reasons.add("opening_window");
  if (input.chapterNo >= 7 && input.chapterNo <= 12 && input.chapterNo % 2 === 0) reasons.add("mid_window");
  if (input.chapterNo >= input.totalChapters) reasons.add("final_chapter");
  if (input.isCompletionCandidate) reasons.add("completion_candidate");
  if (input.policy.manualCheckpointChapters.includes(input.chapterNo)) reasons.add("manual_checkpoint");
  if (input.chapterNo >= input.policy.deepReviewStartChapter && input.chapterNo % input.policy.cadenceChapters === 0) reasons.add("cadence");
  return { shouldDeepReview: reasons.size > 0, triggerReasons: [...reasons] };
}
```

Runner computes this before the Quick gate. Mandatory deep review forces Quick plus Deep even when local checks pass.

- [ ] **Step 4: Verify and commit**

Run: `pnpm test -- src/server/review-policy.test.ts src/server/run-decisions.test.ts src/server/run-manager-smoke.test.ts`
Expected: PASS.

```powershell
git add src/server/run/review-policy.ts src/server/run/run-decisions.ts src/server/run/chapter-runner.ts src/server/review-policy.test.ts src/server/run-decisions.test.ts
git commit -m "fix(review): enforce mandatory deep review windows"
```

### Task 7: Reject Out-of-Window Automatic Rewrites

**Files:**
- Modify: `src/server/run/chapter-review.ts`
- Modify: `src/server/run/chapter-runner.ts`
- Modify: `src/server/review-policy.test.ts`

- [ ] **Step 1: Write failing boundary tests**

```ts
test("rejects earliest affected chapter outside the review window", () => {
  assert.equal(validateEarliestAffectedChapter({ windowStartChapter: 5, currentChapter: 8, value: 4 }).valid, false);
  assert.equal(validateEarliestAffectedChapter({ windowStartChapter: 5, currentChapter: 8, value: 9 }).valid, false);
  assert.equal(validateEarliestAffectedChapter({ windowStartChapter: 5, currentChapter: 8, value: 5 }).valid, true);
  assert.equal(validateEarliestAffectedChapter({ windowStartChapter: 5, currentChapter: 8, value: 8 }).valid, true);
});
```

- [ ] **Step 2: Implement strict validation without clamping**

Invalid values set `earliestAffectedChapter=null`, append a major `invalid_review_window` issue, and require manual review without automatic archive. Runner performs the same assertion immediately before invalidation.

- [ ] **Step 3: Verify and commit**

Run: `pnpm test -- src/server/review-policy.test.ts src/server/run-manual-review-route.test.ts`
Expected: PASS.

```powershell
git add src/server/run/chapter-review.ts src/server/run/chapter-runner.ts src/server/review-policy.test.ts
git commit -m "fix(review): bound automatic rewrite windows"
```

### Task 8: Add Deterministic Cross-Chapter Manuscript Audit

**Files:**
- Create: `src/server/writing/cross-chapter-audit.ts`
- Create: `src/server/cross-chapter-audit.test.ts`
- Modify: `src/server/run/chapter-audit.ts`
- Modify: `src/server/run/chapter-review.ts`
- Modify: `src/server/quick-audit-sync.test.ts`

- [ ] **Step 1: Write the full failure matrix**

Tests cover high paragraph/n-gram overlap, repeated ritual/warning scene templates, character re-entry without a bridge, location jumps, time reversal, incomplete sentences, bad paired punctuation, placeholders, summary endings, and empty-question hooks. Add negative controls for flashbacks, deliberate refrains, and explicit travel.

- [ ] **Step 2: Verify failure**

Run: `pnpm test -- src/server/cross-chapter-audit.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement a deterministic result contract**

```ts
export interface CrossChapterAuditInput {
  chapterNo: number;
  currentText: string;
  previousChapters: Array<{ chapterNo: number; text: string }>;
  previousEndState: { location: string | null; timeMarker: string | null; charactersPresent: string[] } | null;
  currentStartState: { location: string | null; timeMarker: string | null; charactersPresent: string[] } | null;
}

export interface CrossChapterAuditResult {
  verdict: "pass" | "escalate";
  issues: Array<{ type: string; location: string; severity: "minor" | "major"; evidence: string }>;
  repeatedSceneTags: string[];
  overlapScore: number;
}
```

Major deterministic issues cannot be overridden by an LLM `pass`. Quick maps them to `escalate`; Deep maps current-chapter faults to `rewrite_current` and earlier-window faults to a bounded `manual_review_window`.

- [ ] **Step 4: Verify and commit**

Run: `pnpm test -- src/server/cross-chapter-audit.test.ts src/server/quick-audit-sync.test.ts`
Expected: PASS.

```powershell
git add src/server/writing/cross-chapter-audit.ts src/server/cross-chapter-audit.test.ts src/server/run/chapter-audit.ts src/server/run/chapter-review.ts src/server/quick-audit-sync.test.ts
git commit -m "feat(review): add cross-chapter manuscript audit"
```

### Task 9: Enforce the Previous-Chapter Artifact Barrier

**Files:**
- Create: `src/server/run/chapter-prerequisites.ts`
- Create: `src/server/run/chapter-prerequisites.test.ts`
- Modify: `src/server/run/chapter-runner.ts`
- Modify: `src/server/run/chapter-finalize.ts`
- Modify: `src/server/commit/chapter-artifact-sync.ts`
- Modify: `src/server/commit/chapter-artifact-sync.test.ts`

- [ ] **Step 1: Write failing order/readiness tests**

Assert:

```text
ensureChapterArtifactsReady(N-1)
→ ensure/generate Blueprint(N)
→ assembleContextPack(N)
```

Readiness requires exact-chapter brief/detailed/full Summary, Character Snapshot, Canon Facts, and Logic State.

- [ ] **Step 2: Verify failure**

Run: `pnpm test -- src/server/commit/chapter-artifact-sync.test.ts src/server/run/chapter-prerequisites.test.ts`
Expected: FAIL on current order and incomplete readiness.

- [ ] **Step 3: Move accepted-signal persistence after artifact writes**

`prepareChapterPrerequisites()` owns the ordering. Move `persistAcceptedChapterSignals()` from `chapter-finalize.ts` to the artifact sync path after Facts/Snapshot/Summaries are durable.

- [ ] **Step 4: Verify and commit**

Run: `pnpm test -- src/server/commit/chapter-artifact-sync.test.ts src/server/run/chapter-prerequisites.test.ts src/server/run-manager-smoke.test.ts`
Expected: PASS.

```powershell
git add src/server/run/chapter-prerequisites.ts src/server/run/chapter-prerequisites.test.ts src/server/run/chapter-runner.ts src/server/run/chapter-finalize.ts src/server/commit/chapter-artifact-sync.ts src/server/commit/chapter-artifact-sync.test.ts
git commit -m "fix(memory): wait for complete prior-chapter artifacts"
```

### Task 10: Measure Real Context Usage

**Files:**
- Modify: `src/server/types/story.ts`
- Modify: `src/server/run/context-engine.ts`
- Modify: `src/server/services/context-serialization.ts`
- Modify: `src/server/context-engine.test.ts`
- Modify: `src/server/context-serialization.test.ts`

- [ ] **Step 1: Add failing budget tests**

Assert section budgets sum to at most total budget, actual serialized characters equal the final message payload, estimated tokens grow with input, and output reserve is excluded from input usage.

- [ ] **Step 2: Implement explicit budget/usage fields**

```ts
export interface ContextUsage {
  budgetTokens: number;
  estimatedInputTokens: number;
  serializedChars: number;
  sectionUsage: Record<string, { estimatedTokens: number; serializedChars: number }>;
}
```

Change the default percentages to total 100% or less. Build final Quick/Deep messages first, then call `measureReviewMessages(messages)` and persist that measurement.

- [ ] **Step 3: Verify and commit**

Run: `pnpm test -- src/server/context-engine.test.ts src/server/context-serialization.test.ts`
Expected: PASS.

```powershell
git add src/server/types/story.ts src/server/run/context-engine.ts src/server/services/context-serialization.ts src/server/context-engine.test.ts src/server/context-serialization.test.ts
git commit -m "fix(context): record real serialized token usage"
```

### Task 11: Preserve Partial Canon Success

**Files:**
- Modify: `src/server/story/canon.ts`
- Modify: `src/server/commit/chapter-artifact-sync.ts`
- Modify: `src/server/canon.test.ts`
- Modify: `src/server/commit/chapter-artifact-sync.test.ts`
- Modify: `src/server/commit-reconciler.test.ts`

- [ ] **Step 1: Add the three single-component failure tests**

Summary failure must preserve Facts/Snapshot; Facts failure preserves Summary/Snapshot; Snapshot failure preserves Summary/Facts. The aggregate status is `partial_success`.

- [ ] **Step 2: Replace all-or-nothing extraction**

Use `Promise.allSettled()` and return:

```ts
diagnostics: {
  aggregateStatus: "success" | "partial_success" | "degraded";
  components: {
    summary: "success" | "degraded" | "failed";
    facts: "success" | "degraded" | "failed";
    snapshot: "success" | "degraded" | "failed";
  };
}
```

Retry only degraded/failed components; never overwrite successful component files with fallback output.

- [ ] **Step 3: Verify and commit**

Run: `pnpm test -- src/server/canon.test.ts src/server/commit/chapter-artifact-sync.test.ts src/server/commit-reconciler.test.ts`
Expected: PASS.

```powershell
git add src/server/story/canon.ts src/server/commit/chapter-artifact-sync.ts src/server/canon.test.ts src/server/commit/chapter-artifact-sync.test.ts src/server/commit-reconciler.test.ts
git commit -m "fix(canon): retain successful artifact components"
```

### Task 12: Make Patch/Rollback Invalidation Re-entrant

**Files:**
- Modify: `src/server/commit/chapter-commit.service.ts`
- Modify: `src/server/commit/apply-stored-patch.service.ts`
- Modify: `src/server/commit/rollback-version.service.ts`
- Modify: `src/server/services/run-restart.service.ts`
- Modify: `src/server/apply-stored-patch.service.test.ts`
- Modify: `src/server/rollback-version.service.test.ts`
- Modify: `src/server/chapter-reset.test.ts`

- [ ] **Step 1: Add commit-success/invalidation-failure tests**

On replay, versions and commits remain singular, pending invalidation retries, and future chapters archive exactly once.

- [ ] **Step 2: Register a durable mutation effect at finalize time**

Use an operation key derived from project, chapter, old hash, new hash, and patch/version identity. Replays restore pending effects before checking whether current content already matches.

- [ ] **Step 3: Verify and commit**

Run: `pnpm test -- src/server/apply-stored-patch.service.test.ts src/server/rollback-version.service.test.ts src/server/chapter-reset.test.ts`
Expected: PASS.

```powershell
git add src/server/commit/chapter-commit.service.ts src/server/commit/apply-stored-patch.service.ts src/server/commit/rollback-version.service.ts src/server/services/run-restart.service.ts src/server/apply-stored-patch.service.test.ts src/server/rollback-version.service.test.ts src/server/chapter-reset.test.ts
git commit -m "fix(commit): make timeline invalidation re-entrant"
```

### Task 13: Implement Author Review and Approval

**Files:**
- Modify: `src/server/services/author-submission.service.ts`
- Create: `src/server/author-submission.integration.test.ts`
- Modify: `src/server/commit/chapter-session-guard.ts`

- [ ] **Step 1: Write the failing end-to-end service test**

Cover `import → review → revise → review → approve → version → commit → outbox`. Assert `writerCalls === 0`, source is `author_submission`, and a second approve reuses the version/commit while resetting a failed outbox job.

- [ ] **Step 2: Verify failure**

Run: `pnpm test -- src/server/author-submission.integration.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement review/approve without Writer functions**

Review calls only `quickAuditChapter()` and `deepReviewChapter()` with lineage. Approve requires an approved Submission or explicit human override, calls `assertNoOpenSession(projectId, "提交作者稿")`, creates `chapter_versions.source="author_submission"`, and calls Chapter Commit with:

```ts
{
  sourceKind: "workshop",
  acceptedVersionId: versionId,
  idempotencyKey: `${projectId}:${chapterNo}:${versionId}:author-submission:${submissionId}`,
  contentHash: submission.contentHash,
}
```

It must never call `writeDraftFromContext()`, `rewriteChapterFromReview()`, or `finalizeAcceptedChapter()`.

- [ ] **Step 4: Verify and commit**

Run: `pnpm test -- src/server/author-submission.integration.test.ts src/server/chapter-commit-service.test.ts src/server/chapter-mutation-guards.integration.test.ts`
Expected: PASS.

```powershell
git add src/server/services/author-submission.service.ts src/server/author-submission.integration.test.ts src/server/commit/chapter-session-guard.ts
git commit -m "feat(author-mode): review and commit author manuscripts"
```

### Task 14: Add Validated API Routes

**Files:**
- Create: `src/app/api/projects/[projectId]/author-submissions/**/route.ts`
- Modify: `src/server/validation.ts`
- Modify: `src/server/api-route-input-validation.test.ts`
- Modify: `src/server/api-contracts.test.ts`

- [ ] **Step 1: Add failing route validation/contract tests**

Every route validates `projectId`; item routes validate `submissionId`; multipart accepts only `.md/.txt`; client file names never become path segments; JSON bodies use the dedicated Zod schemas.

- [ ] **Step 2: Implement thin routes**

Use the existing route shape:

```ts
export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId: rawProjectId } = await context.params;
    const projectId = projectIdSchema.parse(rawProjectId);
    const payload = authorSubmissionImportSchema.parse(await readJsonBody(request));
    return jsonOk(await authorSubmissionService.importPreview(projectId, payload));
  } catch (error) {
    return jsonFromError(error);
  }
}
```

- [ ] **Step 3: Verify and commit**

Run: `pnpm test -- src/server/api-route-input-validation.test.ts src/server/api-contracts.test.ts`
Expected: PASS.

```powershell
git add src/app/api/projects src/server/validation.ts src/server/api-route-input-validation.test.ts src/server/api-contracts.test.ts
git commit -m "feat(author-mode): expose validated submission APIs"
```

### Task 15: Add the Author Manuscript UI, Responsive Review Drawer, and Live E2E

**Files:**
- Create: `src/lib/types/author-submission.ts`
- Create: `src/components/project/use-author-submission-queries.ts`
- Create: `src/components/author-submissions-client.tsx`
- Create: `src/components/__tests__/author-submissions-client.test.tsx`
- Modify: `src/components/project/use-project-queries.ts`
- Modify: `src/components/project/use-project-detail-controller.tsx`
- Modify: `src/components/project-detail-client.tsx`
- Modify: `src/components/chapter-workshop-client.tsx`
- Modify: `src/components/dashboard/project-creation-form.tsx`
- Modify: `src/components/confirm-dialog.tsx`
- Create/Modify: `e2e/**`, `playwright.config.ts`, `scripts/start-e2e-stack.mjs`, `scripts/verify-author-mode-run.mjs`

- [ ] **Step 1: Write failing component tests**

Cover `?tab=authorSubmissions`, preview-before-import, 80-row virtualization, filters, hash/status display, mutation invalidation, stale report display, accessible dialogs, Escape, focus restore, and pending double-submit guards.

- [ ] **Step 2: Verify component failure**

Run: `pnpm test:ui -- src/components/__tests__/author-submissions-client.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the tab and query surface**

Add `authorSubmissions` to `WorkspaceTab`. Use query keys:

```ts
["author-submissions", projectId, filters]
["author-submission", projectId, submissionId]
```

After import/review/revise/approve, invalidate author submissions, project, progress, and the affected chapter. At widths below `xl`, Review and Version History become an accessible drawer rather than `hidden` content.

- [ ] **Step 4: Rewrite and enable E2E**

Add role/label selectors and stable IDs only for dynamic entities. `04` covers paste/upload/batch, review/revision/approval, lineage, Commit and Writer-zero evidence. `05` covers 80-chapter continuity and MD/TXT downloads. `06` covers 375/768/1279/1440, keyboard operation, dialog focus, progress semantics, and axe scans.

- [ ] **Step 5: Run full verification**

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm test:ui
pnpm exec playwright test --list
pnpm test:e2e
pnpm build
```

Expected: all pass; no key E2E suite contains `describe.skip`.

- [ ] **Step 6: Commit**

```powershell
git add src/lib src/components src/app/api/projects e2e playwright.config.ts scripts package.json pnpm-lock.yaml
git commit -m "feat(author-mode): deliver accessible manuscript workflow"
```

---

## Final Verification Gate

Run from `D:\ainote\ainovel-cli\platform`:

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm test:ui
pnpm test:e2e
pnpm build
git diff --check
git status --short
```

Evidence required before starting the 80-chapter run:

- Author Submission UI supports paste, file, and multi-chapter preview/import.
- Author review/approval integration proves `writer_calls = 0`.
- Review reports are content-hash bound and stale-safe.
- Mandatory Deep Review windows cannot be bypassed.
- Previous-chapter artifacts block next-chapter planning/review until complete.
- Cross-chapter deterministic audit catches the known baseline repetition/continuity failures.
- Canon partial success preserves successful components.
- Patch/Rollback invalidation survives commit-success/invalidation-failure replay.
- Live E2E has no critical skipped suites and covers mobile/keyboard/export.
