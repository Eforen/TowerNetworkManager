/**
 * Pinia wrapper around the pure `transition` reducer in `@/fsm`.
 *
 * Exposes a reactive `state` plus `dispatch(event)`, `reset()`, and a
 * handful of convenience booleans (`isPaletteOpen`, `isModal`) that
 * other stores + the keyboard bridge consume.
 *
 * The store stays thin on purpose: all decision-making happens in the
 * reducer so the FSM is fully unit-testable without a Vue runtime.
 */

import { computed, shallowRef } from 'vue';
import { defineStore } from 'pinia';
import { INITIAL_STATE, transition } from '@/fsm';
import type { AppState, Event } from '@/fsm';

export const useFsmStore = defineStore('fsm', () => {
  const state = shallowRef<AppState>(INITIAL_STATE);

  function dispatch(event: Event): AppState {
    const next = transition(state.value, event);
    if (next !== state.value) state.value = next;
    return state.value;
  }

  function reset(): void {
    state.value = INITIAL_STATE;
  }

  const kind = computed(() => state.value.kind);
  const isPaletteOpen = computed(() => kind.value === 'CommandPaletteOpen');
  const isModal = computed(() =>
    kind.value === 'ConfirmDestructive' || kind.value === 'EditingEntity',
  );
  const isBusy = computed(
    () => kind.value === 'Loading' || kind.value === 'Saving',
  );
  const isPicking = computed(() => kind.value === 'PickingTarget');

  return {
    state,
    kind,
    isPaletteOpen,
    isModal,
    isBusy,
    isPicking,
    dispatch,
    reset,
  };
});

export type FsmStore = ReturnType<typeof useFsmStore>;
