# Reset To Foundation Workshop Design

## Goal

Add a destructive but explicit workspace action that resets a project from any post-writing state back to the editable foundation workshop state. The reset must preserve foundation collaboration context and reusable project assets, permanently remove writing outputs, and let the user continue refining foundation and style choices before manually restarting writing.

## User Experience

The project right panel will expose a `重置到设定工坊` action in the danger area near project deletion. The action will:

- require a destructive confirmation dialog
- permanently remove manuscript- and run-generated outputs
- unlock the foundation so workshop conversation becomes editable again
- keep workshop messages, workshop draft, cards, model assignments, and imported style references
- switch the workspace back to the `设定工坊` tab
- leave the project idle so the user must manually lock the foundation and start writing again

## Reset Semantics

The reset is not a project clone and not a soft timeline invalidation. It is an in-place project reset with irreversible deletion of generated writing artifacts.

### Preserve

- `foundation_workshop_messages`
- `foundation_workshop_states`
- `foundations` content payload
- project metadata such as title, genre, pacing, review policy, assignments
- cards, card messages, and style reference import assets
- style snapshots and workshop style draft values so the user can keep or overwrite them

### Remove

- chapter files, summaries, drafts, checkpoints, versions, reviews, patches, exports
- blueprints and structure artifacts
- chapter delta records and continuity artifacts
- canon facts and foreshadows generated from written chapters
- invalidated chapter history
- run state/session/log artifacts that belong to writing execution
- story contract and steering notes that were derived for execution

## State Transitions

After reset:

- `projects.status` becomes `foundation_ready`
- `foundations.locked_at` becomes `null`
- `run_states` is reset to `idle` with `current_chapter = 1`
- `story_contract_json` becomes `{}`
- `steering_notes_json` becomes `[]`

The project should therefore render as a workshop-editable project with a prepared foundation but without a locked execution state.

## API Shape

Add a new endpoint:

- `POST /api/projects/:projectId/foundation/reset`

This endpoint will validate the project id, reject requests while the project is actively running, execute the reset service, and return refreshed run progress payload so the client can update immediately.

## Server Design

Add a dedicated service rather than piggybacking on chapter-range deletion. The reset has different semantics:

- it always resets from chapter 1
- it must clear run/session/log state more broadly
- it must unlock foundation editing
- it must preserve foundation workshop conversation

The service should reuse existing helpers where useful:

- `deleteChapterArtifactsInRange`
- `clearNovelExport`
- `replaceCanonFacts`
- `replaceForeshadowEntries`
- chapter/review/run repository helpers

It should compute a safe max chapter boundary using written chapters, delta records, invalidations, and current run state, then clear all writing-layer records and files in one transaction plus file cleanup pass.

## Client Design

Add a new callback to the project detail controller and wire it to the right-side run control panel. On success the client should:

- show a success toast
- invalidate project and progress queries
- force `activeTab = "chat"`
- keep the right panel open so the user sees the updated state

## Failure Handling

The reset must fail with a clear error when:

- the project does not exist
- the project is actively running and has not been paused/stopped
- the project has an open chapter session guard that would make destructive cleanup unsafe

File cleanup should remain forceful for generated artifacts, but database updates must stay transactional.

## Testing

Add tests for:

- reset service preserves workshop state and foundation but clears writing outputs
- reset service unlocks foundation and rewinds run state to chapter 1
- route handler returns updated progress payload and validates project id
- client wiring exposes the new destructive action only through explicit confirmation

## Non-Goals

- no automatic rerun after reset
- no recovery archive for deleted manuscript output
- no project cloning or history snapshot feature
