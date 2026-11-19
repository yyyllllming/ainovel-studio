# Platform Refactor Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the current security and migration risk without a big-bang rewrite by fixing the exposed interfaces first, then removing the highest-risk legacy bridges, then finishing the control-plane cutover that already exists in partial form.

**Architecture:** This plan assumes the current codebase already has a partial new control plane in `src/server/run/**` and a still-authoritative legacy executor in `src/server/run-manager.ts`. The work is therefore a cutover-and-containment plan, not a greenfield redesign. We keep API compatibility wherever possible, but we explicitly break secret echo behavior because it is unsafe.

**Tech Stack:** Next.js 16, React 19, TypeScript 5, better-sqlite3, Drizzle ORM, Zod, Node test runner.

---

## Reality Check

This plan is based on the current code, not on desired architecture:

- `run/session.service.ts`, `run/control.service.ts`, `run/session-reconciler.ts`, `run/progress.service.ts`, `run/runner-orchestrator.ts` already exist.
- `run-manager.ts` is still large and still owns legacy control state such as file locks.
- `settings/page.tsx`, `GET /api/settings/llm-profiles`, and `POST /api/settings/llm-profiles/save` all currently move full profile objects containing `apiKey`.
- `GET /api/files/read` currently accepts raw paths, reads from `projects/`, `config/`, `prompts/`, `styles/`, and returns the resolved absolute path.
- There is currently no `middleware.ts`, no request guard, and no existing auth/session layer.

## Non-Goals

- Do not replace SQLite.
- Do not rewrite the whole runner.
- Do not mass-move files just to make the tree look cleaner.
- Do not attempt full artifact unification before the settings/files/control bridges are under control.

## Execution Order

Only start work in this order:

1. Phase 0: Stop the active leaks and freeze contract behavior.
2. Phase 1: Remove the highest-risk direct and dynamic bridges.
3. Phase 2: Finish the existing run control cutover.
4. Phase 3: Normalize persistence authority only after the control plane is stable.

Do **not** start manifest expansion or deep domain splits before Tasks 1-10 are complete.

---

## Phase 0 - Stop The Bleeding

### Task 1: Redact `llm-profiles` End To End

**Files:**
- Create: `platform/src/server/services/settings.service.ts`
- Create: `platform/src/server/types/settings.ts`
- Modify: `platform/src/server/profiles.ts`
- Modify: `platform/src/app/api/settings/llm-profiles/route.ts`
- Modify: `platform/src/app/api/settings/llm-profiles/save/route.ts`
- Modify: `platform/src/app/settings/page.tsx`
- Modify: `platform/src/components/settings-client.tsx`
- Test: `platform/src/server/settings-service.test.ts`

**Why this task exists:**
- The leak is not only in the GET route. It also exists in server-rendered initial props and save responses.

- [ ] Add a safe public DTO for profiles in `src/server/types/settings.ts`.
  - Include `id`, `name`, `providerId`, `baseUrl`, `defaultModel`, `enabled`, `hasApiKey`, `maskedApiKey`.
  - Do not include `apiKey`.

- [ ] Implement a settings service in `src/server/services/settings.service.ts`.
  - Add `listPublicProfiles()`.
  - Add `saveProfileAndReturnPublicView()`.
  - Keep write paths write-only for secrets.

- [ ] Update `src/server/profiles.ts` only as a storage module.
  - Keep secret-bearing types internal.
  - Do not let route/page code call `getProfiles()` directly anymore.

- [ ] Update `GET /api/settings/llm-profiles`.
  - Return `{ profiles: PublicProfile[] }`.
  - Add `Cache-Control: no-store`.

- [ ] Update `POST /api/settings/llm-profiles/save`.
  - Return the safe DTO, not the raw stored profile.

- [ ] Update `src/app/settings/page.tsx`.
  - Stop passing raw profiles into the client.
  - Replace direct `getProfiles()` usage with `listPublicProfiles()`.
  - Use the safe service output for `initialProfiles`.

- [ ] Update `src/components/settings-client.tsx`.
  - Remove the assumption that an existing key can be loaded back into the form.
  - Change edit behavior to "leave blank means keep existing secret".
  - Show `maskedApiKey` or `hasApiKey`, never full key.

- [ ] Add tests in `src/server/settings-service.test.ts`.
  - Assert public DTO never contains `apiKey`.
  - Assert save response returns `hasApiKey=true` and masked output.
  - Assert blank edit payload preserves stored secret.

- [ ] Verify locally.
  - Run: `node --experimental-default-type=module --test --experimental-specifier-resolution=node src/server/settings-service.test.ts`
  - Run: `pnpm typecheck`

**Done when:**
- No browser-visible response or initial prop contains plaintext `apiKey`.
- Existing edit flow still works with "replace secret" semantics.

**Rollback:**
- Revert the client form UX only if needed.
- Do not roll back secret redaction.

---

### Task 2: Harden `GET /api/files/read`

**Files:**
- Create: `platform/src/server/services/file-access.service.ts`
- Modify: `platform/src/server/paths.ts`
- Modify: `platform/src/server/project-files.ts`
- Modify: `platform/src/app/api/files/read/route.ts`
- Test: `platform/src/server/file-access.service.test.ts`
- Test: `platform/src/server/paths.test.ts`

**Why this task exists:**
- The issue is broader than `..` traversal. The route currently exposes too much of the local filesystem contract and leaks absolute paths.

- [ ] Add `FileAccessService` in `src/server/services/file-access.service.ts`.
  - First version: support only project-scoped reads.
  - Accept `projectId`, `relativePath`, `start`, `end`.
  - Reject absolute paths and raw cross-root reads.

- [ ] Tighten `resolveReadablePath` in `src/server/paths.ts`.
  - Remove `configDir` from browser-readable allowlist first.
  - Keep `promptsDir` and `stylesDir` unchanged in this task unless an explicit impact audit shows they are safe to remove.
  - Keep route-facing reads project-scoped only.

- [ ] Update `getFileWindow` in `src/server/project-files.ts`.
  - Stop returning resolved absolute path in the response.
  - Return a logical path only, or omit path entirely.

- [ ] Update `GET /api/files/read`.
  - Move from raw `path` semantics to `projectId + relativePath`.
  - If temporary compatibility is needed, keep old query parsing for one iteration but reject anything outside the project root.

- [ ] Add tests for positive and negative cases.
  - Valid project file read succeeds.
  - `..` and absolute path inputs fail.
  - `config/llm-profiles.json` style access fails.
  - Response does not expose absolute paths.

- [ ] Add a short impact note before changing additional readable roots.
  - Document whether `prompts/` or `styles/` ever need browser-visible reads.
  - Do not broaden this task into a generic root cleanup.

- [ ] Verify locally.
  - Run: `node --experimental-default-type=module --test --experimental-specifier-resolution=node src/server/file-access.service.test.ts src/server/paths.test.ts`
  - Run: `pnpm typecheck`

**Done when:**
- Browser file reads are project-scoped only.
- No response exposes server absolute filesystem paths.

**Rollback:**
- Compatibility parser can stay for one iteration.
- Do not restore non-project readable roots.

---

### Task 3: Add A Minimal Request Guard For High-Risk Routes

**Files:**
- Create: `platform/src/server/security/request-guard.ts`
- Modify: `platform/src/app/api/settings/llm-profiles/route.ts`
- Modify: `platform/src/app/api/settings/llm-profiles/save/route.ts`
- Modify: `platform/src/app/api/settings/llm-profiles/test/route.ts`
- Modify: `platform/src/app/api/settings/llm-profiles/fetch-models/route.ts`
- Modify: `platform/src/app/api/files/read/route.ts`
- Test: `platform/src/server/request-guard.test.ts`

**Why this task exists:**
- There is no auth system today, so the practical first step is a route guard for the highest-risk endpoints, not a fake "full auth complete" claim.

- [ ] Implement `request-guard.ts`.
  - Add `assertLocalBrowserRequest(request)`.
  - Validate `Host`, `Origin`, and `Sec-Fetch-Site` for browser-originated requests.
  - Allow explicit test bypass only through injected test doubles, not production headers.

- [ ] Apply the guard to settings and file routes first.
  - Guard all write endpoints.
  - Guard sensitive reads: `GET /api/settings/llm-profiles`, `GET /api/files/read`.

- [ ] Add negative tests.
  - Missing or cross-site origin is rejected.
  - Same-origin/localhost request is accepted.

- [ ] Document the limitation in code comments and in the plan implementation notes.
  - This is a stopgap, not final auth.
  - Full local session/token work stays in a follow-up task after Phase 0.

- [ ] Verify locally.
  - Run: `node --experimental-default-type=module --test --experimental-specifier-resolution=node src/server/request-guard.test.ts`
  - Run: `pnpm typecheck`

**Done when:**
- High-risk routes are no longer anonymous localhost utilities.
- We have a concrete guard implementation, not a TODO.

**Rollback:**
- None for settings/files routes unless the guard is broken; fix the guard instead.

---

### Task 4: Freeze Core GET Contract Shapes With Snapshot Tests

**Files:**
- Create: `platform/src/server/api-contracts.test.ts`
- Modify: `platform/src/server/http.ts` only if helper support is needed for test execution

**Why this task exists:**
- Phase 1 route-to-service migration can silently change response shapes.
- The frontend currently consumes a small set of hot GET endpoints repeatedly.

- [ ] Add response-shape tests for the most-used frontend GET endpoints.
  - `/api/settings/llm-profiles`
  - `/api/projects`
  - `/api/projects/:projectId`
  - `/api/projects/:projectId/run/progress`
  - `/api/ideas`
  - `/api/authors`

- [ ] Keep the tests shape-focused.
  - Assert presence/absence of fields, not full business content.
  - Treat secret redaction as part of the contract.

- [ ] Use route handler invocation or route-service invocation consistently.
  - Pick the thinnest level that still verifies the serialized response shape.

- [ ] Verify locally.
  - Run: `node --experimental-default-type=module --test --experimental-specifier-resolution=node src/server/api-contracts.test.ts`
  - Run: `pnpm typecheck`

**Done when:**
- Core GET responses have explicit regression protection before service extraction starts.

---

### Task 5: Add Import Boundary Lint Rules

**Files:**
- Modify: `platform/eslint.config.mjs`

**Why this task exists:**
- Without a boundary rule, every cleanup in Phase 1 is reversible by the next casual import.

- [ ] Add `no-restricted-imports` rules for:
  - `src/app/api/**`
  - `src/app/settings/page.tsx`
  - `src/server/run/**`
  - `src/server/services/**`

- [ ] Disallow new direct imports of:
  - `@/server/run-manager`
  - `@/server/repository`
  - `@/server/project-files`
  - `@/server/profiles`

- [ ] Allow narrowly scoped exceptions only with a comment and only in compat modules.

- [ ] Verify locally.
  - Run: `pnpm lint`

**Done when:**
- Boundary regressions fail in lint instead of reappearing silently.

---

## Phase 1 - Remove The Highest-Risk Bridges

### Task 6: Move Settings And File Routes Behind Services

**Files:**
- Modify: `platform/src/app/api/settings/llm-profiles/route.ts`
- Modify: `platform/src/app/api/settings/llm-profiles/save/route.ts`
- Modify: `platform/src/app/api/settings/llm-profiles/test/route.ts`
- Modify: `platform/src/app/api/settings/llm-profiles/fetch-models/route.ts`
- Modify: `platform/src/app/api/files/read/route.ts`
- Modify: `platform/src/server/services/settings.service.ts`
- Modify: `platform/src/server/services/file-access.service.ts`
- Test: `platform/src/server/settings-service.test.ts`
- Test: `platform/src/server/file-access.service.test.ts`

- [ ] Route files must stop importing `profiles.ts` and `project-files.ts` directly.
- [ ] Keep routes thin: parse -> guard -> service -> response DTO.
- [ ] Keep `profiles.ts` as storage/integration logic, not route-facing API logic.
- [ ] Keep `project-files.ts` as infrastructure, not route-facing query logic.
- [ ] Re-run affected tests plus `pnpm typecheck`.

**Done when:**
- The settings and file routes no longer directly call the storage/infrastructure modules they expose.

---

### Task 7: Establish Baseline And Extract The 7 Static `run-manager` Route Entrypoints

**Files:**
- Create: `platform/src/server/services/blueprint-generate.service.ts`
- Create: `platform/src/server/services/foundation-generate.service.ts`
- Create: `platform/src/server/services/chapter-version-generate.service.ts`
- Create: `platform/src/server/services/chapter-range-delete.service.ts`
- Create: `platform/src/server/services/chapter-optimize.service.ts`
- Modify: `platform/src/app/api/projects/[projectId]/blueprints/generate/route.ts`
- Modify: `platform/src/app/api/projects/[projectId]/foundation/generate/route.ts`
- Modify: `platform/src/app/api/projects/[projectId]/chapters/[chapterNo]/generate-versions/route.ts`
- Modify: `platform/src/app/api/projects/[projectId]/chapters/delete-range/route.ts`
- Modify: `platform/src/app/api/projects/[projectId]/chapters/[chapterNo]/apply-patch/route.ts`
- Modify: `platform/src/app/api/projects/[projectId]/chapters/[chapterNo]/rollback/route.ts`
- Modify: `platform/src/app/api/projects/[projectId]/chapters/[chapterNo]/optimize/route.ts`
- Modify: `platform/src/server/commit/apply-stored-patch.service.ts`
- Modify: `platform/src/server/commit/rollback-version.service.ts`
- Modify: `platform/src/server/run-manager.ts`
- Test: route-adjacent integration tests for the 7 endpoints

**Why this task exists:**
- These 7 static route imports are the biggest remaining route-level dependency leak into `run-manager.ts`.

- [ ] Before touching route imports, add or strengthen behavior tests for the extraction targets.
  - `ensureBlueprintGenerated`
  - `ensureFoundationGenerated`
  - `generateVersionsForChapter`
  - `deleteChapterRange`
  - `applyStoredPatch`
  - `rollbackVersion`
  - `optimizeChapterSelection`

- [ ] If any of the route entry extractions require moving shared legacy helpers, extend the baseline to cover:
  - `softInvalidateChapterRange`
  - `persistAcceptedChapterSignals`
  - `finalizeProjectCompletion`
  - `syncCommittedChapterArtifacts`

- [ ] Reuse existing tests before adding new ones.
  - `chapter-reset.test.ts`
  - `chapter-mutation-guards.integration.test.ts`
  - `apply-stored-patch.service.test.ts`
  - `rollback-version.service.test.ts`

- [ ] Move each route off direct `run-manager` imports.
  - `ensureBlueprintGenerated`
  - `ensureFoundationGenerated`
  - `generateVersionsForChapter`
  - `deleteChapterRange`
  - `applyStoredPatch`
  - `rollbackVersion`
  - `optimizeChapterSelection`

- [ ] Prefer existing service modules where they already exist.
  - Reuse `commit/apply-stored-patch.service.ts` and `commit/rollback-version.service.ts` rather than wrapping them twice.
  - Only create new service files for the entry points that do not already have focused homes.

- [ ] Keep `run-manager.ts` export shims temporarily.
  - Change route imports first.
  - Change implementation ownership second.

- [ ] Make this land before the compat-layer task.
  - `compat/legacy-run-manager.ts` should not need to re-export these seven route entry points.

- [ ] Add minimal integration tests for each migrated route or route-service.
  - Focus on response compatibility and permission guards.

**Done when:**
- No route handler statically imports `@/server/run-manager` for these seven entry points.

---

### Task 8: Remove Remaining `repository.ts` Barrel Dependence

**Files:**
- Modify: `platform/src/server/commit/chapter-session-guard.ts`
- Modify: `platform/src/server/services/idea.service.ts`
- Modify: `platform/src/server/services/project.service.ts`
- Modify: `platform/src/server/repository.ts`
- Test: `platform/src/server/chapter-session-guard.test.ts`
- Test: existing `idea.service` / `project.service` adjacent tests

- [ ] Replace `repository.ts` imports in the three known consumers with direct repository imports.
- [ ] Leave `repository.ts` in place for one iteration, but add a deprecation comment at the top.
- [ ] Do not delete the barrel yet.
- [ ] Document the deferred debt explicitly.
  - `run-manager.ts` remains a major `repository.ts` consumer at this stage and is not part of this task.

**Done when:**
- No route or active service work depends on the mega barrel for new work.

---

### Task 9: Quarantine `run-manager.ts` Behind A Single Compat Layer

**Files:**
- Create: `platform/src/server/compat/legacy-run-manager.ts`
- Modify: `platform/src/server/run/manual-review-route.service.ts`
- Modify: `platform/src/server/run/restart-run.service.ts`
- Modify: `platform/src/server/run/runner-orchestrator.ts`
- Modify: `platform/src/server/commit/commit-reconciler-main.ts`
- Test: `platform/src/server/run-manual-review-route.test.ts`
- Test: `platform/src/server/run-control-service.test.ts`

**Why this task exists:**
- Today the legacy bridge is scattered in multiple places. We need one quarantine point before we can cut it over safely.
- This task assumes Task 7 is already complete, so the compat layer only needs dynamic runtime bridges, not the seven route entry points.

- [ ] Create `compat/legacy-run-manager.ts`.
  - Re-export only the still-needed legacy entry points.
  - Add comments that this is a temporary isolation boundary.

- [ ] Update all dynamic imports to go through the compat file.
  - `manual-review-route.service.ts`
  - `restart-run.service.ts`
  - `runner-orchestrator.ts`
  - `commit-reconciler-main.ts`

- [ ] Do not change behavior yet.
  - This task is containment, not extraction.

- [ ] Re-run route/control tests plus `pnpm typecheck`.

**Done when:**
- `run-manager.ts` is no longer imported all over the runtime edge.
- There is one explicit containment seam for follow-up extraction.

---

## Phase 2 - Finish The Existing Control-Plane Cutover

### Task 10: Expand Regression Baseline For Remaining Legacy Extractions

**Files:**
- Modify: existing tests under `platform/src/server/*.test.ts`
- Create: focused tests only where no current baseline exists

**Why this task exists:**
- `run-manager.ts` is not literally untested, but the extraction targets do not yet have enough direct regression protection.

- [ ] Add or strengthen direct behavior coverage for:
  - `softInvalidateChapterRange`
  - `syncCommittedChapterArtifacts`
  - `finalizeProjectCompletion`
  - any shared helper still touched by Task 11 after Task 7 is complete

- [ ] Prefer adding tests around externally visible behavior, not internal line coverage.
- [ ] Reuse existing tests where possible.
  - `chapter-reset.test.ts`
  - `persist-accepted-chapter-signals.test.ts`
  - `run-restart-run-service.test.ts`
  - `commit-reconciler.test.ts`

- [ ] Verify locally.
  - Run the targeted `node --test` suites for the functions above.

**Done when:**
- The next extraction task has a clear regression net for the functions being moved.

---

### Task 11: Extract Low-Risk Legacy Operations Out Of `run-manager.ts`

**Files:**
- Create: `platform/src/server/services/manual-review.service.ts`
- Create: `platform/src/server/services/run-restart.service.ts`
- Create: `platform/src/server/commit/sync-committed-artifacts.service.ts`
- Modify: `platform/src/server/run-manager.ts`
- Modify: `platform/src/server/run/manual-review-route.service.ts`
- Modify: `platform/src/server/run/restart-run.service.ts`
- Modify: `platform/src/server/commit/commit-reconciler-main.ts`
- Test: `platform/src/server/run-manual-review-route.test.ts`
- Test: `platform/src/server/commit-reconciler.test.ts`

- [ ] Move `softInvalidateChapterRange` into a dedicated service.
- [ ] Move `persistAcceptedChapterSignals` and `finalizeProjectCompletion` into a dedicated manual-review service.
- [ ] Move `syncCommittedChapterArtifacts` into a commit-facing service.
- [ ] Keep `run-manager.ts` export shims temporarily, but delegate immediately to the new services.
- [ ] Update compat layer imports to use the new service modules where possible.

**Done when:**
- Manual review, restart, and reconciler flows no longer need to reach deep into `run-manager.ts`.

---

### Task 12: Formalize Run Session Transitions As A Table-Driven State Machine

**Files:**
- Create: `platform/src/server/run/session-state-machine.ts`
- Modify: `platform/src/server/run/session.service.ts`
- Modify: `platform/src/server/run/session-reconciler.ts`
- Test: `platform/src/server/run-session-service.test.ts`
- Test: `platform/src/server/run-state-machine.test.ts`

- [ ] Extract the scattered lifecycle transition rules into a single transition table.
  - Derive the table from the existing conditionals currently scattered across `session.service.ts` and `session-reconciler.ts`.
  - `queued`
  - `launching`
  - `running`
  - `recovering`
  - `paused`
  - `interrupted`
  - `completed`
  - `failed`
  - `stopped`

- [ ] Model `desiredState` transitions explicitly too.
  - `running`
  - `pause_requested`
  - `stop_requested`

- [ ] Make `session.service.ts` and `session-reconciler.ts` call the state machine helper instead of encoding rules inline.
- [ ] Add full matrix tests for legal and illegal transitions.
  - Cover both lifecycle transitions and desired-state transitions.
  - Preserve current semantics unless a task explicitly changes them.

**Done when:**
- Transition rules live in one place and are enforced by tests, not comments.

---

### Task 13: Make The New Run Session Authority Explicit

**Files:**
- Modify: `platform/src/server/run/progress.service.ts`
- Modify: `platform/src/server/run/runner-orchestrator.ts`
- Modify: `platform/src/server/run-manager.ts`
- Test: `platform/src/server/run-progress-service.test.ts`
- Test: `platform/src/server/run-control-service.test.ts`

- [ ] Add explicit comments and telemetry around source-of-truth decisions.
  - DB `run_sessions` is authoritative.
  - Legacy file lock is compat-only.

- [ ] Ensure route-facing progress only comes from `RunProgressView`.
- [ ] Make legacy file-lock reads observational where possible.
- [ ] Add divergence logging when legacy file lock and DB session disagree.
- [ ] Add one regression test covering an interrupted session resuming through the new path while legacy state still exists.

**Done when:**
- The code documents and enforces DB session authority in the active control path.
- File lock usage is visibly transitional, not silently authoritative.

---

## Phase 3 - Normalize Persistence Without Overreaching

### Task 14: Introduce Manifest Authority Only For Chapters, Blueprints, Reviews

**Files:**
- Create: `platform/src/server/infrastructure/artifacts/artifact-manifest.service.ts`
- Create: `platform/src/server/infrastructure/artifacts/integrity-checker.ts`
- Modify: `platform/src/server/commit/chapter-commit.service.ts`
- Modify: `platform/src/server/project-files.ts`
- Modify: `platform/src/server/db/schema.ts`
- Modify: `platform/src/server/db/init.ts`
- Test: `platform/src/server/commit-reconciler.test.ts`
- Test: `platform/src/server/run-vfinal-schema.test.ts`

- [ ] Add manifest metadata only for chapters, blueprints, and reviews.
- [ ] Keep dual-read for one iteration.
- [ ] Do not expand to canon, summaries, or foundation in the first pass.
- [ ] Add integrity scan coverage for missing or mismatched staged/final files.

**Done when:**
- The first three artifact families have explicit authority metadata and recovery checks.

---

## CI / Verification Gates

Every merged task must satisfy:

- `pnpm typecheck`
- targeted `node --test` suites for changed modules
- no new direct route import of:
  - `@/server/profiles`
  - `@/server/project-files`
  - `@/server/repository`
  - `@/server/run-manager`

Recommended temporary lint rule target:

- `src/app/api/**`
- `src/app/settings/page.tsx`
- `src/server/run/**`

## Suggested Delivery Order And Estimates

- Task 1: 1-2 days
- Task 2: 0.5-1 day
- Task 3: 0.5-1 day
- Task 4: 0.5-1 day
- Task 5: 0.25-0.5 day
- Task 6: 0.5 day
- Task 7: 1.5-2.5 days
- Task 8: 0.5 day
- Task 9: 0.5 day
- Task 10: 0.5 day
- Task 11: 2-3 days
- Task 12: 1-2 days
- Task 13: 0.5-1 day
- Task 14: 2-4 days

Total practical first pass: about 3-4 weeks for one engineer, or about 2 weeks with disciplined parallelism on Tasks 1-9.

## What Not To Start Yet

- Do not deep-split `story-progression.ts`.
- Do not deep-split `prose-rescue.ts`.
- Do not redesign the whole `foundation-workshop` tree first.
- Do not attempt "full auth system" before the Phase 0 request guard and safe DTO work land.
- Do not expand artifact manifest beyond chapters, blueprints, reviews in the first persistence pass.

## Handoff Notes

- The plan assumes the first execution wave is Tasks 1-9.
- After Task 9, re-evaluate imports and test coverage before starting Task 10.
- If Task 1 or Task 2 reveals undocumented frontend dependency on unsafe behavior, freeze that dependency in a compatibility note before changing more code.
