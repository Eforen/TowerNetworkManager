<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import { Graph } from '@/model';
import {
  StorageError,
  useFsmStore,
  useGraphStore,
  useProjectStore,
  useSelectionStore,
} from '@/store';
import { bindGlobalKeys } from '@/fsm';
import { CommandPalette } from '@/palette';
import { GraphView } from '@/view';

/**
 * Phase 6 shell: full-window graph view + compact topbar / statusbar.
 * Project controls collapsed into a drawer; command palette still
 * drives most day-to-day actions.
 */

const graphStore = useGraphStore();
const projectStore = useProjectStore();
const fsmStore = useFsmStore();
const selection = useSelectionStore();

const fsmLabel = computed(() => {
  const s = fsmStore.state;
  if (s.kind === 'CommandPaletteOpen') return `CommandPalette/${s.sub}`;
  if (s.kind === 'NodeInspectorOpen') return `NodeInspector(${s.id})`;
  if (s.kind === 'ConfirmDestructive') return `Confirm(${s.op} ${s.id})`;
  if (s.kind === 'PickingTarget') return `Picking(${s.tool})`;
  if (s.kind === 'InspectionResult') return `Inspection(${s.tool})`;
  return s.kind;
});

const slugInput = ref('demo');
const lastMessage = ref<string | null>(null);
const lastError = ref<string | null>(null);
const importField = ref('');
const drawerOpen = ref(false);

const canonicalText = computed(() => graphStore.serializeText());

function flash(msg: string): void {
  lastMessage.value = msg;
  lastError.value = null;
}

function fail(err: unknown): void {
  lastError.value =
    err instanceof StorageError || err instanceof Error ? err.message : String(err);
  lastMessage.value = null;
}

function run(label: string, fn: () => void): void {
  try {
    fn();
    flash(label);
  } catch (err) {
    fail(err);
  }
}

function seedDemoGraph(): void {
  const g = new Graph();
  g.addNode({ type: 'floor', id: 'f1' });
  g.addNode({ type: 'rack', id: 'r1' });
  g.addNode({ type: 'switch', id: 'sw1' });
  g.addNode({ type: 'server', id: 'db01' });
  g.addNode({ type: 'port', id: 'port0', tags: ['RJ45'] });
  g.addNode({
    type: 'port',
    id: '12345',
    tags: ['RJ45', 'UserPort'],
  });
  g.addNode({ type: 'customer', id: 'organic-goat' });
  g.addNode({ type: 'networkaddress', id: '@f1/c/1' });
  g.addNode({ type: 'networkaddress', id: '@f1/s/1' });
  g.addEdge({ relation: 'FloorAssignment', from: { type: 'floor', id: 'f1' }, to: { type: 'rack', id: 'r1' } });
  g.addEdge({ relation: 'RackAssignment', from: { type: 'rack', id: 'r1' }, to: { type: 'switch', id: 'sw1' } });
  g.addEdge({ relation: 'RackAssignment', from: { type: 'rack', id: 'r1' }, to: { type: 'server', id: 'db01' } });
  g.addEdge({ relation: 'NIC', from: { type: 'switch', id: 'sw1' }, to: { type: 'port', id: 'port0' } });
  g.addEdge({
    relation: 'NetworkCableLinkRJ45',
    from: { type: 'port', id: 'port0' },
    to: { type: 'port', id: '12345' },
  });
  g.addEdge({ relation: 'Owner', from: { type: 'customer', id: 'organic-goat' }, to: { type: 'port', id: '12345' } });
  g.addEdge({ relation: 'AssignedTo', from: { type: 'networkaddress', id: '@f1/c/1' }, to: { type: 'customer', id: 'organic-goat' } });
  g.addEdge({ relation: 'AssignedTo', from: { type: 'networkaddress', id: '@f1/s/1' }, to: { type: 'server', id: 'db01' } });
  graphStore.graph = g;
  graphStore.touch();
  projectStore.markDirty();
  flash('Seeded demo graph');
}

function onNew(): void {
  run(`new ${slugInput.value}`, () => projectStore.newProject(slugInput.value));
}
function onSave(): void {
  run('save', () => {
    fsmStore.dispatch({ type: 'saveStart' });
    try { projectStore.save(slugInput.value || undefined); }
    finally { fsmStore.dispatch({ type: 'saveDone' }); }
  });
}
function onLoad(): void {
  run(`load ${slugInput.value}`, () => {
    fsmStore.dispatch({ type: 'loadStart' });
    try { projectStore.load(slugInput.value); }
    finally { fsmStore.dispatch({ type: 'loadDone' }); }
  });
}
function onRemove(): void {
  run(`rm ${slugInput.value}`, () => projectStore.removeProject(slugInput.value));
}
function onExport(): void {
  run('export', () => {
    const { text, filename } = projectStore.exportCurrent();
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  });
}
function onImport(): void {
  run('import', () => projectStore.importText(importField.value));
}

let unbindKeys: (() => void) | null = null;

onMounted(() => {
  try {
    projectStore.hydrate();
    flash(projectStore.active ? `Restored '${projectStore.active}'` : 'Ready');
  } catch (err) {
    fail(err);
  } finally {
    fsmStore.dispatch({ type: 'loadDone' });
  }
  unbindKeys = bindGlobalKeys((ev) => fsmStore.dispatch(ev), {
    isPaletteOpen: () => fsmStore.isPaletteOpen,
  });
});

onBeforeUnmount(() => {
  unbindKeys?.();
  unbindKeys = null;
});
</script>

<template>
  <div class="tni-app">
    <header class="tni-topbar">
      <span class="tni-brand">Tower Networking Inc</span>
      <span class="tni-status">
        <span>{{ graphStore.stats.nodes }}N / {{ graphStore.stats.edges }}E</span>
        <span v-if="projectStore.active">· {{ projectStore.active }}</span>
        <span v-if="projectStore.dirty" class="tni-dirty">· unsaved</span>
        <span class="tni-sel" v-if="selection.count > 0">· sel {{ selection.count }}</span>
        <span class="tni-fsm">· {{ fsmLabel }}</span>
      </span>
      <button class="tni-drawer-toggle" @click="drawerOpen = !drawerOpen">
        {{ drawerOpen ? 'Hide' : 'Project' }}
      </button>
    </header>
    <main class="tni-main">
      <GraphView />
      <aside class="tni-drawer" :class="{ open: drawerOpen }">
        <h2>Project</h2>
        <div class="tni-row">
          <label class="tni-field">
            <span>Slug</span>
            <input v-model="slugInput" placeholder="demo" />
          </label>
        </div>
        <div class="tni-row">
          <button @click="onNew">new</button>
          <button @click="onSave">save</button>
          <button @click="onLoad">load</button>
          <button class="tni-danger" @click="onRemove">rm</button>
        </div>
        <div class="tni-row">
          <button @click="onExport">export</button>
          <button @click="seedDemoGraph">seed demo</button>
        </div>
        <p v-if="lastError" class="tni-msg tni-err">x {{ lastError }}</p>
        <p v-else-if="lastMessage" class="tni-msg tni-ok">ok {{ lastMessage }}</p>
        <details>
          <summary>Import text</summary>
          <textarea v-model="importField" rows="6" placeholder="!tni v1&#10;floor f1"></textarea>
          <button @click="onImport">import</button>
        </details>
        <details open>
          <summary>Canonical text ({{ canonicalText.length }} B)</summary>
          <pre class="tni-code">{{ canonicalText }}</pre>
        </details>
        <p class="tni-hint">
          Press <kbd>`</kbd> for palette. <kbd>f</kbd>/<kbd>g</kbd> fit/floor layout.
        </p>
      </aside>
    </main>
    <CommandPalette />
  </div>
</template>

<style scoped>
.tni-app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  background: var(--tni-bg);
  color: var(--tni-fg);
  font-family: var(--tni-font-ui);
  overflow: hidden;
}
.tni-topbar {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.5rem 1rem;
  border-bottom: 1px solid var(--tni-border);
  background: var(--tni-bg-elevated);
}
.tni-brand {
  font-weight: 600;
  letter-spacing: 0.02em;
}
.tni-status {
  flex: 1;
  display: flex;
  gap: 0.5rem;
  font-family: var(--tni-font-mono);
  color: var(--tni-fg-muted);
  font-size: 0.8rem;
}
.tni-dirty {
  color: var(--tni-warn);
}
.tni-sel {
  color: var(--tni-accent);
}
.tni-fsm {
  color: var(--tni-fg-muted);
}
.tni-drawer-toggle {
  padding: 0.3rem 0.75rem;
  background: var(--tni-bg);
  color: var(--tni-fg);
  border: 1px solid var(--tni-border);
  border-radius: var(--tni-radius);
  cursor: pointer;
}
.tni-main {
  flex: 1;
  position: relative;
  display: flex;
  min-height: 0;
  overflow: hidden;
}
.tni-drawer {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 22rem;
  background: var(--tni-bg-elevated);
  border-left: 1px solid var(--tni-border);
  padding: 1rem 1.25rem;
  overflow: auto;
  transform: translateX(100%);
  transition: transform 150ms ease;
  box-shadow: var(--tni-shadow-2);
}
.tni-drawer.open {
  transform: translateX(0);
}
.tni-drawer h2 {
  margin: 0 0 0.75rem;
  font-size: 1rem;
}
.tni-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-bottom: 0.75rem;
  align-items: end;
}
.tni-field {
  display: flex;
  flex-direction: column;
  font-size: 0.75rem;
  color: var(--tni-fg-muted);
  flex: 1;
}
.tni-field input {
  margin-top: 0.2rem;
  padding: 0.3rem 0.5rem;
  background: var(--tni-bg);
  color: var(--tni-fg);
  border: 1px solid var(--tni-border);
  border-radius: var(--tni-radius);
  font-family: var(--tni-font-mono);
  min-width: 0;
}
button {
  padding: 0.35rem 0.7rem;
  background: var(--tni-bg);
  color: var(--tni-fg);
  border: 1px solid var(--tni-border);
  border-radius: var(--tni-radius);
  font-family: var(--tni-font-ui);
  cursor: pointer;
}
button:hover {
  border-color: var(--tni-accent);
}
button.tni-danger:hover {
  border-color: var(--tni-error);
  color: var(--tni-error);
}
.tni-msg {
  margin: 0 0 0.75rem;
  font-family: var(--tni-font-mono);
  font-size: 0.8rem;
}
.tni-msg.tni-err { color: var(--tni-error); }
.tni-msg.tni-ok  { color: var(--tni-ok); }
details {
  margin: 0 0 0.75rem;
}
summary {
  cursor: pointer;
  color: var(--tni-fg-muted);
  font-size: 0.85rem;
}
textarea {
  display: block;
  width: 100%;
  margin-top: 0.4rem;
  padding: 0.4rem 0.6rem;
  background: var(--tni-bg);
  color: var(--tni-fg);
  border: 1px solid var(--tni-border);
  border-radius: var(--tni-radius);
  font-family: var(--tni-font-mono);
  font-size: 0.8rem;
  resize: vertical;
}
.tni-code {
  background: var(--tni-bg);
  border: 1px solid var(--tni-border);
  border-radius: var(--tni-radius);
  padding: 0.5rem 0.75rem;
  margin-top: 0.4rem;
  line-height: 1.4;
  overflow: auto;
  max-height: 12rem;
  font-family: var(--tni-font-mono);
  font-size: 0.78rem;
}
.tni-hint {
  margin: 0.5rem 0 0;
  color: var(--tni-fg-muted);
  font-size: 0.8rem;
}
kbd {
  background: var(--tni-bg);
  border: 1px solid var(--tni-border);
  border-radius: 4px;
  padding: 0 0.3em;
  font-family: var(--tni-font-mono);
  font-size: 0.85em;
}
</style>
