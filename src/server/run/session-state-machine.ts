import "../server-only.ts";

import type { RunSessionDesiredState, RunSessionLifecycleStatus } from "../repositories/run-session.repository.ts";

export const RUN_SESSION_LIFECYCLE_STATES = [
  "queued",
  "launching",
  "running",
  "recovering",
  "paused",
  "interrupted",
  "completed",
  "failed",
  "stopped",
] as const satisfies readonly RunSessionLifecycleStatus[];

export const RUN_SESSION_DESIRED_STATES = [
  "running",
  "pause_requested",
  "stop_requested",
] as const satisfies readonly RunSessionDesiredState[];

export type SessionLifecycleTransitionEvent =
  | "enter_runner_slot"
  | "acquire_lease_running"
  | "acquire_lease_recovering"
  | "release_paused"
  | "release_completed"
  | "release_failed"
  | "release_stopped"
  | "pause_without_lease"
  | "stop_without_lease"
  | "stale_launch_timeout"
  | "lease_expired_pause"
  | "lease_expired_stop"
  | "lease_expired_interrupt";

export type SessionDesiredTransitionEvent =
  | "preserve"
  | "request_pause"
  | "request_stop"
  | "reset_running";

type SessionLifecycleTransitionTable = {
  enter_runner_slot: Partial<Record<RunSessionLifecycleStatus, Extract<RunSessionLifecycleStatus, "launching" | "running" | "recovering">>>;
  acquire_lease_running: Partial<Record<RunSessionLifecycleStatus, Extract<RunSessionLifecycleStatus, "running">>>;
  acquire_lease_recovering: Partial<Record<RunSessionLifecycleStatus, Extract<RunSessionLifecycleStatus, "recovering">>>;
  release_paused: Partial<Record<RunSessionLifecycleStatus, Extract<RunSessionLifecycleStatus, "paused">>>;
  release_completed: Partial<Record<RunSessionLifecycleStatus, Extract<RunSessionLifecycleStatus, "completed">>>;
  release_failed: Partial<Record<RunSessionLifecycleStatus, Extract<RunSessionLifecycleStatus, "failed">>>;
  release_stopped: Partial<Record<RunSessionLifecycleStatus, Extract<RunSessionLifecycleStatus, "stopped">>>;
  pause_without_lease: Partial<Record<RunSessionLifecycleStatus, Extract<RunSessionLifecycleStatus, "paused">>>;
  stop_without_lease: Partial<Record<RunSessionLifecycleStatus, Extract<RunSessionLifecycleStatus, "stopped">>>;
  stale_launch_timeout: Partial<Record<RunSessionLifecycleStatus, Extract<RunSessionLifecycleStatus, "interrupted">>>;
  lease_expired_pause: Partial<Record<RunSessionLifecycleStatus, Extract<RunSessionLifecycleStatus, "paused">>>;
  lease_expired_stop: Partial<Record<RunSessionLifecycleStatus, Extract<RunSessionLifecycleStatus, "stopped">>>;
  lease_expired_interrupt: Partial<Record<RunSessionLifecycleStatus, Extract<RunSessionLifecycleStatus, "interrupted">>>;
};

type SessionDesiredTransitionTable = {
  preserve: Record<RunSessionDesiredState, RunSessionDesiredState>;
  request_pause: Record<RunSessionDesiredState, Extract<RunSessionDesiredState, "pause_requested">>;
  request_stop: Record<RunSessionDesiredState, Extract<RunSessionDesiredState, "stop_requested">>;
  reset_running: Record<RunSessionDesiredState, Extract<RunSessionDesiredState, "running">>;
};

const LIFECYCLE_TRANSITIONS: SessionLifecycleTransitionTable = {
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

const DESIRED_STATE_TRANSITIONS: SessionDesiredTransitionTable = {
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

export function transitionLifecycle<Event extends SessionLifecycleTransitionEvent>(input: {
  from: RunSessionLifecycleStatus;
  event: Event;
}): NonNullable<SessionLifecycleTransitionTable[Event][RunSessionLifecycleStatus]> {
  const transitionsForEvent = LIFECYCLE_TRANSITIONS[input.event];
  const next = transitionsForEvent[input.from];
  if (!next) {
    throw new Error(`illegal session lifecycle transition: ${input.from} -> ${input.event}`);
  }
  return next as NonNullable<SessionLifecycleTransitionTable[Event][RunSessionLifecycleStatus]>;
}

export function transitionDesiredState<Event extends SessionDesiredTransitionEvent>(input: {
  from: RunSessionDesiredState;
  event: Event;
}): SessionDesiredTransitionTable[Event][RunSessionDesiredState] {
  return DESIRED_STATE_TRANSITIONS[input.event][input.from];
}

export function isTerminalSessionLifecycle(status: RunSessionLifecycleStatus) {
  return status === "completed" || status === "failed" || status === "stopped";
}

export function isActiveRunnerLifecycle(status: RunSessionLifecycleStatus) {
  return status === "launching" || status === "running" || status === "recovering";
}

export function isLeaseHeldLifecycle(status: RunSessionLifecycleStatus) {
  return status === "running" || status === "recovering";
}
