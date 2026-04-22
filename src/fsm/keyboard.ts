/**
 * Global keyboard bridge between the browser and the FSM.
 *
 * Per docs/specs/statemachine.md §"Transition rules":
 *
 *   - `backtick` fires only when focus is NOT inside a text-entry
 *     element. Palette itself re-captures the key via its own input.
 *   - `escape` always fires and peels one level off the active state.
 *   - `Tab` / `Shift+Tab` cycle completions while the palette is open;
 *     everywhere else we let the browser handle tab navigation.
 *
 * `bindGlobalKeys(dispatch)` returns an `unbind` function for easy
 * `onScopeDispose` teardown in Vue setup blocks.
 */

import type { Event } from './types';

export type DispatchFn = (event: Event) => void;

const TEXT_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export function isTextFocus(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (TEXT_TAGS.has(target.tagName)) return true;
  if (target.isContentEditable) return true;
  return false;
}

export interface BindOptions {
  /**
   * Override focus check; primarily used by tests. Default treats any
   * currently focused text field as "typing" so backtick is swallowed.
   */
  isTextFocus?: (target: EventTarget | null) => boolean;
  /**
   * Returns `true` when the palette is currently open. Some keys (tab,
   * shift+tab, enter, escape) need different handling depending on
   * whether the palette owns focus. Consumers pass a getter into the
   * FSM store so the reducer stays pure.
   */
  isPaletteOpen?: () => boolean;
  target?: EventTarget & {
    addEventListener: typeof window.addEventListener;
    removeEventListener: typeof window.removeEventListener;
  };
}

export function bindGlobalKeys(
  dispatch: DispatchFn,
  options: BindOptions = {},
): () => void {
  const target = options.target ?? window;
  const focusCheck = options.isTextFocus ?? isTextFocus;
  const paletteCheck = options.isPaletteOpen ?? (() => false);

  function handler(e: KeyboardEvent): void {
    if (e.key === '`' && !focusCheck(e.target)) {
      e.preventDefault();
      dispatch({ type: 'backtick' });
      return;
    }
    if (e.key === 'Escape') {
      dispatch({ type: 'escape' });
      return;
    }
    if (!paletteCheck()) return;

    if (e.key === 'Tab') {
      e.preventDefault();
      dispatch({ type: e.shiftKey ? 'shiftTab' : 'tab' });
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      dispatch({ type: 'enter' });
    }
  }

  target.addEventListener('keydown', handler as EventListener);
  return () => target.removeEventListener('keydown', handler as EventListener);
}
