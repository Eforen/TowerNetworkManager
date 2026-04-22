/**
 * Pure transition reducer for the app FSM.
 *
 * `transition(state, event)` returns the next `AppState` or the same
 * reference when the event is a no-op in that state. All reasoning about
 * the spec's state diagram lives here; `fsmStore` just wraps this with
 * Pinia reactivity.
 *
 * Cross-cutting rules encoded here:
 *
 *   - `escape` peels off one nesting level per
 *     docs/specs/statemachine.md §Transition rules.
 *   - `ExecutingCommand` is non-cancellable (no escape out).
 *   - Destructive ops (`rm node` / `rm edge`) only route through
 *     `ConfirmDestructive` when `force !== true`.
 *   - `Saving` / `Loading` are top-level and swallow palette events.
 *   - `PickingTarget` re-routes `clickNode` to `pickFirst`/`pickSecond`.
 *
 * Anything outside the documented diagram is a no-op (returns the same
 * `state` reference) so callers can cheaply detect "nothing happened".
 */

import type { AppState, Event, PaletteSub } from './types';

export function transition(state: AppState, event: Event): AppState {
  switch (state.kind) {
    case 'Loading':
      return fromLoading(state, event);
    case 'Idle':
      return fromIdle(state, event);
    case 'CommandPaletteOpen':
      return fromPalette(state, event);
    case 'FilterPanelOpen':
      return fromFilterPanel(state, event);
    case 'NodeInspectorOpen':
      return fromInspector(state, event);
    case 'EditingEntity':
      return fromEditing(state, event);
    case 'ConfirmDestructive':
      return fromConfirm(state, event);
    case 'PickingTarget':
      return fromPicking(state, event);
    case 'InspectionResult':
      return fromInspectionResult(state, event);
    case 'Saving':
      return fromSaving(state, event);
  }
}

// ---------------------------------------------------------------------------
// Top-level states
// ---------------------------------------------------------------------------

function fromLoading(state: AppState, event: Event): AppState {
  if (event.type === 'loadDone') return { kind: 'Idle' };
  return state;
}

function fromIdle(state: AppState, event: Event): AppState {
  switch (event.type) {
    case 'backtick':
      return openPalette();
    case 'toggleFilters':
      return { kind: 'FilterPanelOpen' };
    case 'clickNode':
      return { kind: 'NodeInspectorOpen', id: event.id };
    case 'loadStart':
      return { kind: 'Loading' };
    case 'saveStart':
      return { kind: 'Saving' };
    case 'startPick':
      return { kind: 'PickingTarget', tool: event.tool };
    default:
      return state;
  }
}

function fromFilterPanel(state: AppState, event: Event): AppState {
  if (event.type === 'toggleFilters' || event.type === 'escape') {
    return { kind: 'Idle' };
  }
  return state;
}

function fromInspector(
  state: AppState & { kind: 'NodeInspectorOpen' },
  event: Event,
): AppState {
  switch (event.type) {
    case 'clickBackground':
    case 'escape':
      return { kind: 'Idle' };
    case 'clickNode':
      return { kind: 'NodeInspectorOpen', id: event.id };
    case 'edit':
      return {
        kind: 'EditingEntity',
        target: event.entity ?? { kind: 'node', id: state.id, type: 'unknown' },
        draft: {},
      };
    case 'delete':
      if (event.force) return { kind: 'Idle' };
      return {
        kind: 'ConfirmDestructive',
        op: event.op ?? 'rmNode',
        id: event.id,
        returnTo: state,
      };
    case 'backtick':
      return openPalette();
    default:
      return state;
  }
}

function fromEditing(
  state: AppState & { kind: 'EditingEntity' },
  event: Event,
): AppState {
  switch (event.type) {
    case 'cancel':
    case 'escape':
      if (state.target.id) {
        return { kind: 'NodeInspectorOpen', id: state.target.id };
      }
      return { kind: 'Idle' };
    case 'commandOk':
      return { kind: 'Idle' };
    case 'delete':
      if (event.force) return { kind: 'Idle' };
      return {
        kind: 'ConfirmDestructive',
        op: event.op ?? 'rmNode',
        id: event.id,
        returnTo: state,
      };
    default:
      return state;
  }
}

function fromConfirm(
  state: AppState & { kind: 'ConfirmDestructive' },
  event: Event,
): AppState {
  switch (event.type) {
    case 'confirm':
      return { kind: 'Idle' };
    case 'cancel':
    case 'escape':
      return state.returnTo;
    default:
      return state;
  }
}

function fromPicking(
  state: AppState & { kind: 'PickingTarget' },
  event: Event,
): AppState {
  switch (event.type) {
    case 'pickFirst':
      return { kind: 'PickingTarget', tool: state.tool, first: event.id };
    case 'pickSecond':
      if (event.result === undefined) return state; // wait for inspectDone
      return { kind: 'InspectionResult', tool: state.tool, result: event.result };
    case 'inspectDone':
      return { kind: 'InspectionResult', tool: state.tool, result: event.result };
    case 'escape':
    case 'inspectCancel':
      return { kind: 'Idle' };
    case 'clickNode':
      if (!state.first) {
        return { kind: 'PickingTarget', tool: state.tool, first: event.id };
      }
      return state; // pickSecond must be dispatched explicitly with result
    case 'clickBackground':
      return state; // suppressed during picking
    default:
      return state;
  }
}

function fromInspectionResult(
  state: AppState & { kind: 'InspectionResult' },
  event: Event,
): AppState {
  switch (event.type) {
    case 'escape':
    case 'inspectCancel':
      return { kind: 'Idle' };
    case 'startPick':
      return { kind: 'PickingTarget', tool: event.tool };
    case 'clickNode':
      return { kind: 'NodeInspectorOpen', id: event.id };
    default:
      return state;
  }
}

function fromSaving(state: AppState, event: Event): AppState {
  if (event.type === 'saveDone') return { kind: 'Idle' };
  return state;
}

// ---------------------------------------------------------------------------
// CommandPaletteOpen with substates
// ---------------------------------------------------------------------------

function fromPalette(
  state: AppState & { kind: 'CommandPaletteOpen' },
  event: Event,
): AppState {
  // Top-level palette events regardless of substate.
  switch (event.type) {
    case 'backtick':
      return { kind: 'Idle' };
    case 'loadStart':
      return { kind: 'Loading' };
    case 'saveStart':
      return { kind: 'Saving' };
    case 'startPick':
      return { kind: 'PickingTarget', tool: event.tool };
  }

  // Substate-specific transitions.
  switch (state.sub) {
    case 'Typing':
      return fromPaletteTyping(state, event);
    case 'ShowingCompletions':
      return fromPaletteShowingCompletions(state, event);
    case 'ExecutingCommand':
      return fromPaletteExecuting(state, event);
    case 'ShowingError':
      return fromPaletteShowingError(state, event);
  }
}

function fromPaletteTyping(
  state: AppState & { kind: 'CommandPaletteOpen' },
  event: Event,
): AppState {
  switch (event.type) {
    case 'escape':
      return { kind: 'Idle' };
    case 'tab':
    case 'shiftTab':
      return withSub(state, 'ShowingCompletions');
    case 'inputChanged':
      return {
        ...state,
        sub: 'ShowingCompletions',
        input: event.input,
        cursor: event.cursor ?? event.input.length,
      };
    case 'enter':
      return withSub(state, 'ExecutingCommand');
    default:
      return state;
  }
}

function fromPaletteShowingCompletions(
  state: AppState & { kind: 'CommandPaletteOpen' },
  event: Event,
): AppState {
  switch (event.type) {
    case 'escape':
      return withSub(state, 'Typing');
    case 'inputChanged':
      return {
        ...state,
        input: event.input,
        cursor: event.cursor ?? event.input.length,
      };
    case 'tab':
    case 'shiftTab':
      return state; // cycling is internal to completion list
    case 'enter':
      return withSub(state, 'ExecutingCommand');
    default:
      return state;
  }
}

function fromPaletteExecuting(
  state: AppState & { kind: 'CommandPaletteOpen' },
  event: Event,
): AppState {
  switch (event.type) {
    case 'commandOk':
      return { kind: 'Idle' };
    case 'commandErr':
      return { ...state, sub: 'ShowingError', error: event.message };
    default:
      return state; // non-cancellable
  }
}

function fromPaletteShowingError(
  state: AppState & { kind: 'CommandPaletteOpen' },
  event: Event,
): AppState {
  switch (event.type) {
    case 'escape':
      return { ...state, sub: 'Typing', error: undefined };
    case 'inputChanged':
      return {
        ...state,
        sub: 'Typing',
        error: undefined,
        input: event.input,
        cursor: event.cursor ?? event.input.length,
      };
    case 'enter':
      return withSub({ ...state, error: undefined }, 'ExecutingCommand');
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function openPalette(): AppState {
  return {
    kind: 'CommandPaletteOpen',
    sub: 'Typing',
    input: '',
    cursor: 0,
    history: [],
  };
}

function withSub(
  state: AppState & { kind: 'CommandPaletteOpen' },
  sub: PaletteSub,
): AppState {
  return { ...state, sub };
}
