/**
 * Keyboard bridge: emits FSM events in response to window keydowns,
 * with focus-trap rules per docs/specs/statemachine.md §Transition rules.
 */

import { describe, expect, it } from 'vitest';
import { bindGlobalKeys, type Event as FsmEvent } from '@/fsm';

interface FakeTarget {
  addEventListener: (t: string, h: EventListener) => void;
  removeEventListener: (t: string, h: EventListener) => void;
  dispatch(key: string, opts?: { shift?: boolean; inInput?: boolean }): void;
}

function fakeTarget(): FakeTarget {
  let handler: EventListener | null = null;
  return {
    addEventListener(_, h) {
      handler = h;
    },
    removeEventListener() {
      handler = null;
    },
    dispatch(key, opts = {}) {
      const target = opts.inInput
        ? document.createElement('input')
        : document.createElement('div');
      const ev = {
        key,
        shiftKey: opts.shift ?? false,
        target,
        preventDefault() {
          /* noop */
        },
      } as unknown as KeyboardEvent;
      handler?.(ev as unknown as Event);
    },
  };
}

function collect(
  opts: { paletteOpen?: boolean; inInput?: boolean } = {},
): { events: FsmEvent[]; target: FakeTarget; unbind: () => void } {
  const events: FsmEvent[] = [];
  const target = fakeTarget();
  const unbind = bindGlobalKeys((e) => events.push(e), {
    target: target as unknown as Window,
    isPaletteOpen: () => opts.paletteOpen ?? false,
    isTextFocus: () => opts.inInput ?? false,
  });
  return { events, target, unbind };
}

describe('keyboard – backtick', () => {
  it('emits backtick when focus is not in a text field', () => {
    const { events, target } = collect();
    target.dispatch('`');
    expect(events).toEqual([{ type: 'backtick' }]);
  });

  it('does not emit when focus is in a text field', () => {
    const { events, target } = collect({ inInput: true });
    target.dispatch('`');
    expect(events).toEqual([]);
  });
});

describe('keyboard – escape', () => {
  it('always emits, even inside inputs', () => {
    const { events, target } = collect({ inInput: true });
    target.dispatch('Escape');
    expect(events).toEqual([{ type: 'escape' }]);
  });
});

describe('keyboard – palette-gated keys', () => {
  it('tab + shift+tab only emit while palette is open', () => {
    const closed = collect({ paletteOpen: false });
    closed.target.dispatch('Tab');
    expect(closed.events).toEqual([]);

    const open = collect({ paletteOpen: true });
    open.target.dispatch('Tab');
    open.target.dispatch('Tab', { shift: true });
    expect(open.events).toEqual([{ type: 'tab' }, { type: 'shiftTab' }]);
  });

  it('enter only emits while palette is open', () => {
    const closed = collect({ paletteOpen: false });
    closed.target.dispatch('Enter');
    expect(closed.events).toEqual([]);

    const open = collect({ paletteOpen: true });
    open.target.dispatch('Enter');
    expect(open.events).toEqual([{ type: 'enter' }]);
  });
});

describe('keyboard – unbind', () => {
  it('stops emitting after unbind()', () => {
    const { events, target, unbind } = collect();
    unbind();
    target.dispatch('`');
    expect(events).toEqual([]);
  });
});
