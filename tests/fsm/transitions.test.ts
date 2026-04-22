/**
 * Covers every labeled edge in the mermaid diagram at
 * docs/specs/statemachine.md §Diagram, plus the transition rules text.
 */

import { describe, expect, it } from 'vitest';
import { INITIAL_STATE, transition, type AppState, type Event } from '@/fsm';

function run(state: AppState, ...events: Event[]): AppState {
  return events.reduce((acc, ev) => transition(acc, ev), state);
}

const idle: AppState = { kind: 'Idle' };

describe('fsm – boot + Loading', () => {
  it('starts in Loading', () => {
    expect(INITIAL_STATE).toEqual({ kind: 'Loading' });
  });

  it('Loading --loadDone--> Idle', () => {
    expect(transition(INITIAL_STATE, { type: 'loadDone' }))
      .toEqual(idle);
  });

  it('Loading ignores unrelated events', () => {
    expect(transition(INITIAL_STATE, { type: 'backtick' }).kind).toBe('Loading');
  });
});

describe('fsm – Idle top-level transitions', () => {
  it('Idle --backtick--> CommandPaletteOpen/Typing', () => {
    const next = transition(idle, { type: 'backtick' });
    expect(next.kind).toBe('CommandPaletteOpen');
    if (next.kind === 'CommandPaletteOpen') {
      expect(next.sub).toBe('Typing');
      expect(next.input).toBe('');
    }
  });

  it('Idle --toggleFilters--> FilterPanelOpen', () => {
    expect(transition(idle, { type: 'toggleFilters' }).kind).toBe(
      'FilterPanelOpen',
    );
  });

  it('Idle --clickNode--> NodeInspectorOpen', () => {
    const next = transition(idle, { type: 'clickNode', id: 'n1' });
    expect(next).toEqual({ kind: 'NodeInspectorOpen', id: 'n1' });
  });

  it('Idle --saveStart--> Saving and --saveDone--> Idle', () => {
    const saving = transition(idle, { type: 'saveStart' });
    expect(saving.kind).toBe('Saving');
    expect(transition(saving, { type: 'saveDone' })).toEqual(idle);
  });

  it('Idle --loadStart--> Loading', () => {
    expect(transition(idle, { type: 'loadStart' }).kind).toBe('Loading');
  });

  it('Idle --startPick--> PickingTarget', () => {
    const next = transition(idle, { type: 'startPick', tool: 'route' });
    expect(next).toEqual({ kind: 'PickingTarget', tool: 'route' });
  });
});

describe('fsm – FilterPanelOpen', () => {
  const filter: AppState = { kind: 'FilterPanelOpen' };
  it('toggleFilters or escape closes it', () => {
    expect(transition(filter, { type: 'toggleFilters' })).toEqual(idle);
    expect(transition(filter, { type: 'escape' })).toEqual(idle);
  });
});

describe('fsm – CommandPaletteOpen', () => {
  const open = run(idle, { type: 'backtick' });

  it('backtick toggles back to Idle', () => {
    expect(transition(open, { type: 'backtick' })).toEqual(idle);
  });

  it('Typing --escape--> Idle', () => {
    expect(transition(open, { type: 'escape' })).toEqual(idle);
  });

  it('Typing --tab--> ShowingCompletions', () => {
    const next = transition(open, { type: 'tab' });
    expect(next.kind).toBe('CommandPaletteOpen');
    if (next.kind === 'CommandPaletteOpen') expect(next.sub).toBe('ShowingCompletions');
  });

  it('Typing --inputChanged--> ShowingCompletions with updated input', () => {
    const next = transition(open, {
      type: 'inputChanged',
      input: 'add n',
    });
    expect(next.kind).toBe('CommandPaletteOpen');
    if (next.kind === 'CommandPaletteOpen') {
      expect(next.sub).toBe('ShowingCompletions');
      expect(next.input).toBe('add n');
      expect(next.cursor).toBe(5);
    }
  });

  it('ShowingCompletions --escape--> Typing (not Idle)', () => {
    const shown = run(open, { type: 'tab' });
    const next = transition(shown, { type: 'escape' });
    expect(next.kind).toBe('CommandPaletteOpen');
    if (next.kind === 'CommandPaletteOpen') expect(next.sub).toBe('Typing');
  });

  it('Typing --enter--> ExecutingCommand', () => {
    const next = transition(open, { type: 'enter' });
    expect(next.kind).toBe('CommandPaletteOpen');
    if (next.kind === 'CommandPaletteOpen') expect(next.sub).toBe('ExecutingCommand');
  });

  it('ShowingCompletions --enter--> ExecutingCommand', () => {
    const shown = run(open, { type: 'tab' });
    const next = transition(shown, { type: 'enter' });
    if (next.kind === 'CommandPaletteOpen') expect(next.sub).toBe('ExecutingCommand');
  });

  it('ExecutingCommand --commandOk--> Idle', () => {
    const exec = run(open, { type: 'enter' });
    expect(transition(exec, { type: 'commandOk' })).toEqual(idle);
  });

  it('ExecutingCommand --commandErr--> ShowingError with message', () => {
    const exec = run(open, { type: 'enter' });
    const next = transition(exec, { type: 'commandErr', message: 'boom' });
    expect(next.kind).toBe('CommandPaletteOpen');
    if (next.kind === 'CommandPaletteOpen') {
      expect(next.sub).toBe('ShowingError');
      expect(next.error).toBe('boom');
    }
  });

  it('ShowingError --inputChanged--> Typing (clears error)', () => {
    const err = run(
      open,
      { type: 'enter' },
      { type: 'commandErr', message: 'boom' },
    );
    const next = transition(err, { type: 'inputChanged', input: 'help' });
    if (next.kind === 'CommandPaletteOpen') {
      expect(next.sub).toBe('Typing');
      expect(next.error).toBeUndefined();
      expect(next.input).toBe('help');
    }
  });

  it('ExecutingCommand ignores escape (non-cancellable)', () => {
    const exec = run(open, { type: 'enter' });
    expect(transition(exec, { type: 'escape' })).toBe(exec);
  });

  it('CommandPaletteOpen --startPick--> PickingTarget', () => {
    const next = transition(open, { type: 'startPick', tool: 'bottleneck' });
    expect(next.kind).toBe('PickingTarget');
  });

  it('CommandPaletteOpen --saveStart--> Saving', () => {
    expect(transition(open, { type: 'saveStart' }).kind).toBe('Saving');
  });
});

describe('fsm – NodeInspectorOpen', () => {
  const inspector: AppState = { kind: 'NodeInspectorOpen', id: 'n1' };

  it('escape or clickBackground returns to Idle', () => {
    expect(transition(inspector, { type: 'escape' })).toEqual(idle);
    expect(transition(inspector, { type: 'clickBackground' })).toEqual(idle);
  });

  it('clickNode re-targets the inspector', () => {
    const next = transition(inspector, { type: 'clickNode', id: 'n2' });
    expect(next).toEqual({ kind: 'NodeInspectorOpen', id: 'n2' });
  });

  it('edit enters EditingEntity for the selected node', () => {
    const next = transition(inspector, { type: 'edit', id: 'n1' });
    expect(next.kind).toBe('EditingEntity');
  });

  it('delete enters ConfirmDestructive unless --force', () => {
    const confirm = transition(inspector, { type: 'delete', id: 'n1' });
    expect(confirm.kind).toBe('ConfirmDestructive');

    const forced = transition(inspector, {
      type: 'delete',
      id: 'n1',
      force: true,
    });
    expect(forced).toEqual(idle);
  });
});

describe('fsm – EditingEntity', () => {
  const editing: AppState = {
    kind: 'EditingEntity',
    target: { kind: 'node', id: 'n1', type: 'switch' },
    draft: {},
  };

  it('cancel returns to NodeInspectorOpen when editing an existing node', () => {
    expect(transition(editing, { type: 'cancel' })).toEqual({
      kind: 'NodeInspectorOpen',
      id: 'n1',
    });
  });

  it('escape behaves like cancel', () => {
    expect(transition(editing, { type: 'escape' })).toEqual({
      kind: 'NodeInspectorOpen',
      id: 'n1',
    });
  });

  it('cancel returns to Idle when creating a new entity (no id)', () => {
    const creating: AppState = {
      kind: 'EditingEntity',
      target: { kind: 'node', type: 'switch' },
      draft: {},
    };
    expect(transition(creating, { type: 'cancel' })).toEqual(idle);
  });

  it('commandOk exits to Idle', () => {
    expect(transition(editing, { type: 'commandOk' })).toEqual(idle);
  });

  it('delete enters ConfirmDestructive with editing as returnTo', () => {
    const next = transition(editing, { type: 'delete', id: 'n1' });
    expect(next.kind).toBe('ConfirmDestructive');
    if (next.kind === 'ConfirmDestructive') {
      expect(next.returnTo).toEqual(editing);
    }
  });
});

describe('fsm – ConfirmDestructive', () => {
  const inspector: AppState = { kind: 'NodeInspectorOpen', id: 'n1' };
  const confirm = transition(inspector, { type: 'delete', id: 'n1' });

  it('confirm returns to Idle', () => {
    expect(transition(confirm, { type: 'confirm' })).toEqual(idle);
  });

  it('cancel returns to the prior state verbatim', () => {
    expect(transition(confirm, { type: 'cancel' })).toEqual(inspector);
  });

  it('escape is equivalent to cancel here', () => {
    expect(transition(confirm, { type: 'escape' })).toEqual(inspector);
  });
});

describe('fsm – PickingTarget + InspectionResult', () => {
  const picking: AppState = { kind: 'PickingTarget', tool: 'route' };

  it('pickFirst stores the first endpoint', () => {
    const next = transition(picking, { type: 'pickFirst', id: 'n1' });
    expect(next).toEqual({ kind: 'PickingTarget', tool: 'route', first: 'n1' });
  });

  it('first clickNode dispatches as pickFirst implicitly', () => {
    const next = transition(picking, { type: 'clickNode', id: 'n1' });
    expect(next).toEqual({ kind: 'PickingTarget', tool: 'route', first: 'n1' });
  });

  it('clickBackground is suppressed during picking', () => {
    expect(transition(picking, { type: 'clickBackground' })).toBe(picking);
  });

  it('pickSecond with inline result transitions to InspectionResult', () => {
    const withFirst = transition(picking, { type: 'pickFirst', id: 'n1' });
    const done = transition(withFirst, {
      type: 'pickSecond',
      id: 'n2',
      result: { hops: [] },
    });
    expect(done.kind).toBe('InspectionResult');
  });

  it('pickSecond without result waits for inspectDone', () => {
    const withFirst = transition(picking, { type: 'pickFirst', id: 'n1' });
    const stillPicking = transition(withFirst, {
      type: 'pickSecond',
      id: 'n2',
    });
    expect(stillPicking.kind).toBe('PickingTarget');

    const done = transition(stillPicking, {
      type: 'inspectDone',
      result: 'r',
    });
    expect(done.kind).toBe('InspectionResult');
  });

  it('escape or inspectCancel in PickingTarget returns to Idle', () => {
    expect(transition(picking, { type: 'escape' })).toEqual(idle);
    expect(transition(picking, { type: 'inspectCancel' })).toEqual(idle);
  });

  it('InspectionResult --clickNode--> NodeInspectorOpen', () => {
    const result: AppState = {
      kind: 'InspectionResult',
      tool: 'route',
      result: {},
    };
    expect(transition(result, { type: 'clickNode', id: 'n1' })).toEqual({
      kind: 'NodeInspectorOpen',
      id: 'n1',
    });
  });

  it('InspectionResult --startPick--> PickingTarget', () => {
    const result: AppState = {
      kind: 'InspectionResult',
      tool: 'route',
      result: {},
    };
    const next = transition(result, { type: 'startPick', tool: 'bottleneck' });
    expect(next).toEqual({ kind: 'PickingTarget', tool: 'bottleneck' });
  });

  it('InspectionResult --escape--> Idle', () => {
    const result: AppState = {
      kind: 'InspectionResult',
      tool: 'route',
      result: {},
    };
    expect(transition(result, { type: 'escape' })).toEqual(idle);
  });
});

describe('fsm – Saving/Loading gates', () => {
  it('Saving only accepts saveDone', () => {
    const saving: AppState = { kind: 'Saving' };
    expect(transition(saving, { type: 'backtick' })).toBe(saving);
    expect(transition(saving, { type: 'saveDone' })).toEqual(idle);
  });

  it('Loading only accepts loadDone', () => {
    const loading: AppState = { kind: 'Loading' };
    expect(transition(loading, { type: 'backtick' })).toBe(loading);
    expect(transition(loading, { type: 'loadDone' })).toEqual(idle);
  });
});

describe('fsm – no-op semantics', () => {
  it('returns the same reference when the event is not handled', () => {
    const result: AppState = {
      kind: 'InspectionResult',
      tool: 'route',
      result: {},
    };
    expect(transition(result, { type: 'toggleFilters' })).toBe(result);
  });
});
