/**
 * App state machine types per docs/specs/statemachine.md.
 *
 * `AppState` is a discriminated union on `kind`; each kind carries only
 * the extra data it needs. `Event` is a discriminated union on `type`.
 *
 * The spec's sketched `State shape` has `ConfirmDestructive.returnTo:
 * AppState['kind']`; we keep the full prior `AppState` instead so that
 * cancelling a delete can restore an inspector or editing draft without
 * losing its transient data. Documented deviation.
 */

export type PaletteSub =
  | 'Typing'
  | 'ShowingCompletions'
  | 'ExecutingCommand'
  | 'ShowingError';

export interface EditTarget {
  kind: 'node' | 'edge';
  /** Undefined means a brand-new entity is being created. */
  id?: string;
  /** NodeType or RelationName depending on `kind`. */
  type: string;
}

/**
 * Placeholder result shape for `inspect route` / `inspect bottleneck`.
 * Phase 12 will refine this when the tools actually compute something.
 */
export type InspectResult = unknown;

export type AppState =
  | { kind: 'Loading' }
  | { kind: 'Idle' }
  | {
      kind: 'CommandPaletteOpen';
      sub: PaletteSub;
      input: string;
      cursor: number;
      history: string[];
      error?: string;
    }
  | { kind: 'FilterPanelOpen' }
  | { kind: 'NodeInspectorOpen'; id: string }
  | { kind: 'EditingEntity'; target: EditTarget; draft: Record<string, unknown> }
  | {
      kind: 'ConfirmDestructive';
      op: 'rmNode' | 'rmEdge';
      id: string;
      returnTo: AppState;
    }
  | { kind: 'PickingTarget'; tool: 'route' | 'bottleneck'; first?: string }
  | {
      kind: 'InspectionResult';
      tool: 'route' | 'bottleneck';
      result: InspectResult;
    }
  | { kind: 'Saving' };

export type AppStateKind = AppState['kind'];

export type Event =
  | { type: 'backtick' }
  | { type: 'escape' }
  | { type: 'clickNode'; id: string }
  | { type: 'clickBackground' }
  | { type: 'toggleFilters' }
  | { type: 'edit'; id: string; entity?: EditTarget }
  | { type: 'delete'; id: string; op?: 'rmNode' | 'rmEdge'; force?: boolean }
  | { type: 'confirm' }
  | { type: 'cancel' }
  | { type: 'inputChanged'; input: string; cursor?: number }
  | { type: 'tab' }
  | { type: 'shiftTab' }
  | { type: 'enter' }
  | { type: 'commandOk' }
  | { type: 'commandErr'; message: string }
  | { type: 'loadStart' }
  | { type: 'loadDone' }
  | { type: 'saveStart' }
  | { type: 'saveDone' }
  | { type: 'startPick'; tool: 'route' | 'bottleneck' }
  | { type: 'pickFirst'; id: string }
  | { type: 'pickSecond'; id: string; result?: InspectResult }
  | { type: 'inspectDone'; result: InspectResult }
  | { type: 'inspectCancel' };

export type EventType = Event['type'];

export const INITIAL_STATE: AppState = { kind: 'Loading' };
