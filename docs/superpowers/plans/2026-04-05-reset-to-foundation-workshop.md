# Reset To Foundation Workshop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a destructive in-place reset action that returns a project to editable foundation workshop state while permanently deleting all generated writing outputs.

**Architecture:** Implement a dedicated server reset service that clears writing-layer records/files, unlocks the foundation, and rewinds run state. Expose it through a new project API route and wire a confirmed danger action into the existing right-side project control panel.

**Tech Stack:** Next.js route handlers, React client state with TanStack Query, TypeScript, better-sqlite3 repositories, Node test runner.

---

### Task 1: Capture reset service behavior with tests

**Files:**
- Modify: `src/server/chapter-reset.test.ts`

- [ ] **Step 1: Write the failing reset-service test**

Add a test that creates a locked project with foundation workshop messages, foundation workshop state, written chapter files, run state, story contract, steering notes, canon artifacts, invalidation history, and run logs; call `resetProjectToFoundationWorkshop(projectId)` and assert the project remains foundation-ready, unlocked, current chapter rewinds to 1, and writing artifacts are gone while workshop content remains.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/server/chapter-reset.test.ts`
Expected: FAIL because `resetProjectToFoundationWorkshop` does not exist yet.

- [ ] **Step 3: Keep assertions focused on preserved vs removed layers**

Make the test check these exact expectations:
- workshop messages count preserved
- workshop draft preserved
- `foundations.locked_at` cleared
- `projects.status` equals `foundation_ready`
- `story_contract_json` and `steering_notes_json` reset
- `run_states.current_chapter` equals `1`
- chapter files and invalidated history files removed

- [ ] **Step 4: Re-run the single test file**

Run: `pnpm test -- src/server/chapter-reset.test.ts`
Expected: FAIL only on missing implementation.

### Task 2: Capture route behavior with tests

**Files:**
- Create: `src/server/foundation-reset-route.test.ts`

- [ ] **Step 1: Write the failing route test**

Create a route-service level test for a new `resolveFoundationResetRequest()` helper that validates `projectId`, delegates to a reset service dependency, and returns the refreshed run progress payload.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/server/foundation-reset-route.test.ts`
Expected: FAIL because the route helper file does not exist yet.

- [ ] **Step 3: Include invalid-project-id coverage**

Add a test that passes an invalid `projectId` and expects the helper to reject before calling the reset dependency.

- [ ] **Step 4: Re-run the route test file**

Run: `pnpm test -- src/server/foundation-reset-route.test.ts`
Expected: FAIL on missing implementation only.

### Task 3: Implement the reset service

**Files:**
- Create: `src/server/services/foundation-reset.service.ts`
- Modify: `src/server/repositories/foundation.repository.ts`

- [ ] **Step 1: Implement repository helper to unlock foundation**

Add a focused repository helper such as `unlockFoundation(projectId)` that clears `foundations.locked_at` and updates `projects.status` to `foundation_ready`.

- [ ] **Step 2: Implement the reset service**

In `src/server/services/foundation-reset.service.ts`, add `resetProjectToFoundationWorkshop(projectId)` that:
- validates project existence
- blocks active runs using existing run-state checks/session guard
- computes the highest generated chapter boundary
- deletes writing-layer records
- clears canon/foreshadow/export artifacts
- unlocks foundation
- resets project execution state and returns `buildRunProgress(projectId)`

- [ ] **Step 3: Reuse existing helpers instead of duplicating file cleanup**

Use existing helpers from `project-files.ts`, chapter/review/run repositories, and session guard modules rather than ad-hoc SQL or path logic.

- [ ] **Step 4: Run the service test file**

Run: `pnpm test -- src/server/chapter-reset.test.ts`
Expected: PASS for the new reset test and existing chapter reset coverage remains green.

### Task 4: Implement route helper and API endpoint

**Files:**
- Create: `src/server/foundation-reset-route.service.ts`
- Create: `src/app/api/projects/[projectId]/foundation/reset/route.ts`

- [ ] **Step 1: Implement route helper**

Add a helper mirroring existing route-service tests: parse params, validate `projectId`, call the reset service dependency, return the resulting progress payload.

- [ ] **Step 2: Implement route handler**

Create the Next.js route file that calls the helper and returns `jsonOk` / `jsonError` responses consistent with existing route patterns.

- [ ] **Step 3: Run route tests**

Run: `pnpm test -- src/server/foundation-reset-route.test.ts`
Expected: PASS.

- [ ] **Step 4: Run combined backend verification**

Run: `pnpm test -- src/server/chapter-reset.test.ts src/server/foundation-reset-route.test.ts`
Expected: PASS.

### Task 5: Wire the client action into the workspace

**Files:**
- Modify: `src/components/project/run-control-panel.tsx`
- Modify: `src/components/project/use-project-detail-controller.tsx`

- [ ] **Step 1: Add panel props for the new reset action**

Extend the run control props shape with `onResetToFoundationWorkshop` and render a dedicated danger button labeled `重置到设定工坊`.

- [ ] **Step 2: Implement confirmed client mutation**

In the project detail controller, add a confirmed mutation call to `POST /api/projects/${projectId}/foundation/reset`, show a success toast, invalidate relevant queries, and switch the active tab to `"chat"` on success.

- [ ] **Step 3: Keep destructive copy explicit**

Use confirmation text that states manuscript, blueprint, review, and export outputs are permanently deleted while foundation conversation, cards, and model configuration are retained.

- [ ] **Step 4: Run relevant UI test coverage if available**

Run: `pnpm test -- src/server/frontend-architecture.test.ts`
Expected: PASS, with no architecture regressions from the new client wiring.

### Task 6: Final verification

**Files:**
- No code changes expected

- [ ] **Step 1: Run targeted lint-free verification commands**

Run: `pnpm test -- src/server/chapter-reset.test.ts src/server/foundation-reset-route.test.ts`
Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Review changed files for UX copy and safety**

Check that the button label, confirmation dialog, and error messages consistently use `重置到设定工坊` semantics rather than generic chapter deletion wording.

- [ ] **Step 4: Stop with a clean summary**

Report preserved data, deleted data, verification commands run, and any residual risks.
