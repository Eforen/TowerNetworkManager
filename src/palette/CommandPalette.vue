<!--
  Command palette UI per docs/specs/commandline.md.

  Scope (Phase 5):
    - Overlay visible whenever FSM.kind === 'CommandPaletteOpen'.
    - Input line with '>' prompt, monospace font.
    - Completions popup (up to 12) cycled with Tab / Shift+Tab.
    - Status line shows the last command result / error.
    - History persisted under `tni.cmdhistory`; Up/Down walks it.

  Deferred to later phases:
    - Reverse-incremental search (Ctrl+R).
    - Ghost-text preview.
    - Ctrl+Enter "run without closing".
-->
<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useFsmStore, useGraphStore, useProjectStore } from '@/store';
import {
  CommandHistory,
  complete,
  execute,
  getRegistry,
  registerBuiltins,
  type Candidate,
} from '@/commands';

const fsm = useFsmStore();
const graphStore = useGraphStore();
const projectStore = useProjectStore();

const registry = getRegistry();
if (registry.all().length === 0) registerBuiltins(registry);
const history = new CommandHistory();

const inputRef = ref<HTMLInputElement | null>(null);
const buffer = ref('');
const caret = ref(0);
const candidates = ref<Candidate[]>([]);
const selectedIndex = ref(0);
const replaceRange = ref<[number, number]>([0, 0]);
const hint = ref('');
const statusLine = ref('');
const statusKind = ref<'ok' | 'err' | 'hint' | ''>('');

const isOpen = computed(() => fsm.state.kind === 'CommandPaletteOpen');
const showCompletions = computed(
  () =>
    fsm.state.kind === 'CommandPaletteOpen'
    && fsm.state.sub === 'ShowingCompletions'
    && candidates.value.length > 0,
);
const historyCount = computed(() => history.size());

function refreshCompletions(): void {
  const result = complete(
    buffer.value,
    caret.value,
    registry,
    graphStore.graph,
  );
  candidates.value = result.candidates;
  replaceRange.value = result.replace;
  hint.value = result.hint ?? '';
  if (selectedIndex.value >= candidates.value.length) {
    selectedIndex.value = 0;
  }
}

function onInput(ev: globalThis.Event): void {
  const el = ev.target as HTMLInputElement;
  buffer.value = el.value;
  caret.value = el.selectionStart ?? el.value.length;
  statusKind.value = '';
  statusLine.value = '';
  fsm.dispatch({
    type: 'inputChanged',
    input: buffer.value,
    cursor: caret.value,
  });
  refreshCompletions();
}

function acceptCandidate(offset: number): void {
  if (candidates.value.length === 0) {
    fsm.dispatch({ type: 'tab' });
    refreshCompletions();
    if (candidates.value.length === 0) return;
  }
  selectedIndex.value = mod(
    selectedIndex.value + offset,
    candidates.value.length,
  );
  const cand = candidates.value[selectedIndex.value];
  const [start, end] = replaceRange.value;
  const before = buffer.value.slice(0, start);
  const after = buffer.value.slice(end);
  const next = `${before}${cand.value}${after}`;
  buffer.value = next;
  caret.value = (before + cand.value).length;
  void nextTick(() => syncInputRef());
  fsm.dispatch({ type: 'tab' });
}

async function runCurrent(): Promise<void> {
  const input = buffer.value.trim();
  if (input.length === 0) return;
  fsm.dispatch({ type: 'enter' });
  const result = await execute(input, registry, {
    graph: graphStore.graph,
    graphStore,
    projectStore,
    fsmStore: fsm,
    registry,
    history,
    log: (line) => {
      statusLine.value = line;
      statusKind.value = 'hint';
    },
  });
  if (result.ok) {
    history.push(input);
    statusLine.value = result.message ?? 'ok';
    statusKind.value = 'ok';
    buffer.value = '';
    caret.value = 0;
    refreshCompletions();
    fsm.dispatch({ type: 'commandOk' });
  } else {
    statusLine.value = result.message;
    statusKind.value = 'err';
    fsm.dispatch({ type: 'commandErr', message: result.message });
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Tab') {
    event.preventDefault();
    event.stopPropagation();
    acceptCandidate(event.shiftKey ? -1 : 1);
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    event.stopPropagation();
    void runCurrent();
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    if (
      candidates.value.length > 0
      && fsm.state.kind === 'CommandPaletteOpen'
      && fsm.state.sub === 'ShowingCompletions'
    ) {
      candidates.value = [];
      fsm.dispatch({ type: 'escape' });
      return;
    }
    history.reset();
    fsm.dispatch({ type: 'escape' });
    return;
  }
  if (event.key === 'ArrowUp') {
    const entry = history.walkPrev(buffer.value);
    if (entry !== null) {
      event.preventDefault();
      buffer.value = entry;
      caret.value = entry.length;
      void nextTick(() => syncInputRef());
      refreshCompletions();
    }
    return;
  }
  if (event.key === 'ArrowDown') {
    const entry = history.walkNext();
    if (entry !== null) {
      event.preventDefault();
      buffer.value = entry;
      caret.value = entry.length;
      void nextTick(() => syncInputRef());
      refreshCompletions();
    }
    return;
  }
  if (event.key === '`') {
    event.preventDefault();
    event.stopPropagation();
    fsm.dispatch({ type: 'backtick' });
    return;
  }
}

function syncInputRef(): void {
  const el = inputRef.value;
  if (!el) return;
  if (el.value !== buffer.value) el.value = buffer.value;
  el.setSelectionRange(caret.value, caret.value);
}

function onFocusRestore(): void {
  if (isOpen.value) inputRef.value?.focus();
}

watch(
  () => isOpen.value,
  async (open) => {
    if (open) {
      buffer.value = '';
      caret.value = 0;
      statusLine.value = '';
      statusKind.value = '';
      candidates.value = [];
      selectedIndex.value = 0;
      await nextTick();
      inputRef.value?.focus();
    }
  },
);

onMounted(() => {
  window.addEventListener('click', onFocusRestore);
});
onUnmounted(() => {
  window.removeEventListener('click', onFocusRestore);
});

function mod(a: number, b: number): number {
  return ((a % b) + b) % b;
}
</script>

<template>
  <Transition name="palette">
    <div v-if="isOpen" class="tni-palette" role="dialog" aria-label="Command palette">
      <div class="tni-palette__inputrow">
        <span class="tni-palette__prompt">&gt;</span>
        <input
          ref="inputRef"
          class="tni-palette__input"
          :value="buffer"
          spellcheck="false"
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          aria-label="Command input"
          @input="onInput"
          @keydown="onKeydown"
        />
      </div>
      <ul v-if="showCompletions" class="tni-palette__completions">
        <li
          v-for="(c, i) in candidates"
          :key="c.value"
          :class="{ active: i === selectedIndex }"
        >
          <span class="tni-palette__cand-value">{{ c.label ?? c.value }}</span>
          <span v-if="c.detail" class="tni-palette__cand-detail">{{ c.detail }}</span>
        </li>
      </ul>
      <div class="tni-palette__meta">
        <span>[history: {{ historyCount }}/200]</span>
        <span v-if="hint" class="tni-palette__hint">{{ hint }}</span>
        <span class="tni-palette__keys">
          <kbd>Tab</kbd> complete  <kbd>Enter</kbd> run  <kbd>Esc</kbd> close
        </span>
      </div>
      <div
        class="tni-palette__status"
        :class="{
          'tni-palette__status--ok': statusKind === 'ok',
          'tni-palette__status--err': statusKind === 'err',
          'tni-palette__status--hint': statusKind === 'hint',
        }"
      >
        {{ statusLine || '(ready)' }}
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.tni-palette {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  max-height: 40vh;
  background: var(--tni-bg-elev, #1b1e23);
  color: var(--tni-fg, #e7e9ee);
  border-bottom: 1px solid var(--tni-border, #2d323b);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.35);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 14px;
  line-height: 1.5;
  display: flex;
  flex-direction: column;
  z-index: 1000;
}

.tni-palette__inputrow {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--tni-border, #2d323b);
}

.tni-palette__prompt {
  color: var(--tni-accent, #4a9eff);
  font-weight: 700;
  user-select: none;
}

.tni-palette__input {
  flex: 1 1 auto;
  background: transparent;
  border: 0;
  outline: 0;
  color: inherit;
  font: inherit;
  padding: 0;
}

.tni-palette__completions {
  list-style: none;
  margin: 0;
  padding: 0.25rem 0;
  max-height: 18rem;
  overflow-y: auto;
  border-bottom: 1px solid var(--tni-border, #2d323b);
}

.tni-palette__completions li {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.25rem 1rem;
}

.tni-palette__completions li.active {
  background: var(--tni-accent-muted, rgba(74, 158, 255, 0.15));
}

.tni-palette__cand-detail {
  color: var(--tni-fg-dim, #8a93a0);
  font-size: 12px;
}

.tni-palette__meta {
  display: flex;
  gap: 1rem;
  padding: 0.25rem 1rem;
  color: var(--tni-fg-dim, #8a93a0);
  font-size: 12px;
  border-bottom: 1px solid var(--tni-border, #2d323b);
}

.tni-palette__meta kbd {
  background: var(--tni-bg, #0f1115);
  border: 1px solid var(--tni-border, #2d323b);
  border-radius: 3px;
  padding: 0 0.25rem;
  font-size: 11px;
}

.tni-palette__status {
  padding: 0.35rem 1rem;
  font-size: 13px;
  color: var(--tni-fg-dim, #8a93a0);
}

.tni-palette__status--ok {
  color: var(--tni-ok, #3ecf8e);
}

.tni-palette__status--err {
  color: var(--tni-error, #ff6b6b);
}

.tni-palette__status--hint {
  color: var(--tni-warn, #d09030);
}

.palette-enter-active,
.palette-leave-active {
  transition: transform 150ms ease, opacity 150ms ease;
}

.palette-enter-from,
.palette-leave-to {
  transform: translateY(-12%);
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .palette-enter-active,
  .palette-leave-active {
    transition: none;
  }
}
</style>
