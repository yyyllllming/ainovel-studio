import test from "node:test";
import assert from "node:assert/strict";

import {
  RUN_SESSION_DESIRED_STATES,
  RUN_SESSION_LIFECYCLE_STATES,
  transitionDesiredState,
  transitionLifecycle,
  type SessionDesiredTransitionEvent,
  type SessionLifecycleTransitionEvent,
} from "./run/session-state-machine.ts";

const lifecycleExpectations: Record<
  SessionLifecycleTransitionEvent,
  Partial<Record<(typeof RUN_SESSION_LIFECYCLE_STATES)[number], (typeof RUN_SESSION_LIFECYCLE_STATES)[number]>>
> = {
  enter_runner_slot: {
    queued: "launching",
    paused: "launching",
    interrupted: "launching",
    launching: "launching",
    running: "running",
    recovering: "recovering",
  },
  acquire_lease_running: {
    launching: "running",
    running: "running",
    recovering: "running",
  },
  acquire_lease_recovering: {
    launching: "recovering",
    running: "recovering",
    recovering: "recovering",
  },
  release_paused: {
    running: "paused",
    recovering: "paused",
  },
  release_completed: {
    running: "completed",
    recovering: "completed",
  },
  release_failed: {
    running: "failed",
    recovering: "failed",
  },
  release_stopped: {
    running: "stopped",
    recovering: "stopped",
  },
  pause_without_lease: {
    queued: "paused",
    launching: "paused",
    running: "paused",
    recovering: "paused",
    paused: "paused",
    interrupted: "paused",
  },
  stop_without_lease: {
    queued: "stopped",
    launching: "stopped",
    running: "stopped",
    recovering: "stopped",
    paused: "stopped",
    interrupted: "stopped",
  },
  stale_launch_timeout: {
    queued: "interrupted",
    launching: "interrupted",
  },
  lease_expired_pause: {
    running: "paused",
    recovering: "paused",
  },
  lease_expired_stop: {
    running: "stopped",
    recovering: "stopped",
  },
  lease_expired_interrupt: {
    running: "interrupted",
    recovering: "interrupted",
  },
};

const desiredExpectations: Record<
  SessionDesiredTransitionEvent,
  Record<(typeof RUN_SESSION_DESIRED_STATES)[number], (typeof RUN_SESSION_DESIRED_STATES)[number]>
> = {
  preserve: {
    running: "running",
    pause_requested: "pause_requested",
    stop_requested: "stop_requested",
  },
  request_pause: {
    running: "pause_requested",
    pause_requested: "pause_requested",
    stop_requested: "pause_requested",
  },
  request_stop: {
    running: "stop_requested",
    pause_requested: "stop_requested",
    stop_requested: "stop_requested",
  },
  reset_running: {
    running: "running",
    pause_requested: "running",
    stop_requested: "running",
  },
};

test("session lifecycle state machine accepts only the documented transitions", () => {
  for (const [event, expectations] of Object.entries(lifecycleExpectations) as Array<
    [SessionLifecycleTransitionEvent, typeof lifecycleExpectations[SessionLifecycleTransitionEvent]]
  >) {
    for (const from of RUN_SESSION_LIFECYCLE_STATES) {
      const expected = expectations[from];
      if (expected) {
        assert.equal(transitionLifecycle({ from, event }), expected, `${event} should allow ${from} -> ${expected}`);
        continue;
      }

      assert.throws(
        () => transitionLifecycle({ from, event }),
        /illegal session lifecycle transition/,
        `${event} should reject ${from}`,
      );
    }
  }
});

test("session desired-state state machine keeps pause and stop requests explicit", () => {
  for (const [event, expectations] of Object.entries(desiredExpectations) as Array<
    [SessionDesiredTransitionEvent, typeof desiredExpectations[SessionDesiredTransitionEvent]]
  >) {
    for (const from of RUN_SESSION_DESIRED_STATES) {
      assert.equal(
        transitionDesiredState({ from, event }),
        expectations[from],
        `${event} should map ${from} -> ${expectations[from]}`,
      );
    }
  }
});
