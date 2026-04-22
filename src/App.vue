<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import { Graph } from '@/model';
import {
  StorageError,
  useFsmStore,
  useGraphStore,
  useProjectStore,
} from '@/store';
import { bindGlobalKeys } from '@/fsm';
import { CommandPalette } from '@/palette';

/**
 * Phase 3 smoke UI: project controls wired to Pinia. Provides visible
 * feedback that `new / save / load / rm / export / import` round-trip
 * through `localStorage` via the TNI v1 format. Goes away once the real
 * command palette + graph view take over (Phases 5–6).
 */

const graphStore = useGraphStore();
const projectStore = useProjectStore();
const fsmStore = useFsmStore();

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

const canonicalText = computed(() => graphStore.serializeText());

function flash(msg: string): void {
  lastMessage.value = msg;
  lastError.value = null;
}

function fail(err: unknown): void {
  lastError.value =
    err instanceof StorageError || err instanceof Error
      ? err.message
      : String(err);
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
  g.addNode({ type: 'port', id: '@f1/s/1', tags: ['RJ45'] });
  g.addNode({
    type: 'port',
    id: '@f1/c/1',
    tags: ['RJ45', 'UserPort'],
    properties: { deviceAddress: 12345 },
  });
  g.addNode({ type: 'customer', id: 'organic-goat' });
  g.addEdge({
    relation: 'FloorAssignment',
    from: { type: 'floor', id: 'f1' },
    to: { type: 'rack', id: 'r1' },
  });
  g.addEdge({
    relation: 'RackAssignment',
    from: { type: 'rack', id: 'r1' },
    to: { type: 'switch', id: 'sw1' },
  });
  g.addEdge({
    relation: 'RackAssignment',
    from: { type: 'rack', id: 'r1' },
    to: { type: 'server', id: 'db01' },
  });
  g.addEdge({
    relation: 'NIC',
    from: { type: 'switch', id: 'sw1' },
    to: { type: 'port', id: '@f1/s/1' },
  });
  g.addEdge({
    relation: 'NetworkCableLinkRJ45',
    from: { type: 'port', id: '@f1/s/1' },
    to: { type: 'port', id: '@f1/c/1' },
  });
  g.addEdge({
    relation: 'Owner',
    from: { type: 'customer', id: 'organic-goat' },
    to: { type: 'port', id: '@f1/c/1' },
  });
  graphStore.graph = g;
  graphStore.revision++;
  projectStore.markDirty();
  flash('Seeded demo graph');
}

function onNew(): void {
  run(`new ${slugInput.value}`, () => projectStore.newProject(slugInput.value));
}
function onSave(): void {
  run('save', () => {
    fsmStore.dispatch({ type: 'saveStart' });
    try {
      projectStore.save(slugInput.value || undefined);
    } finally {
      fsmStore.dispatch({ type: 'saveDone' });
    }
  });
}
function onLoad(): void {
  run(`load ${slugInput.value}`, () => {
    fsmStore.dispatch({ type: 'loadStart' });
    try {
      projectStore.load(slugInput.value);
    } finally {
      fsmStore.dispatch({ type: 'loadDone' });
    }
  });
}
function onRemove(): void {
  run(`rm ${slugInput.value}`, () =>
    projectStore.removeProject(slugInput.value),
  );
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
    flash(
      projectStore.active
        ? `Restored '${projectStore.active}'`
        : 'Ready',
    );
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
      <span class="tni-status">Phase 5 palette · {{ fsmLabel }}</span>
    </header>
    <main class="tni-main">
      <section class="tni-card">
        <h1>Projects + TNI v1 persistence</h1>
        <p class="tni-lead">
          Backed by <code>localStorage</code>. Slug list lives under
          <code>tni.projects</code>; each project under
          <code>tni.project.&lt;slug&gt;</code>.
        </p>

        <div class="tni-row">
          <label class="tni-field">
            <span>Slug</span>
            <input v-model="slugInput" placeholder="demo" />
          </label>
          <button @click="onNew">new</button>
          <button @click="onSave">save</button>
          <button @click="onLoad">load</button>
          <button class="tni-danger" @click="onRemove">rm</button>
          <button @click="onExport">export</button>
          <button @click="seedDemoGraph">seed demo</button>
        </div>

        <dl class="tni-stats">
          <div>
            <dt>Active</dt>
            <dd>{{ projectStore.active ?? '-' }}</dd>
          </div>
          <div>
            <dt>Dirty</dt>
            <dd :class="{ 'tni-warn': projectStore.dirty }">
              {{ projectStore.dirty ? 'yes' : 'no' }}
            </dd>
          </div>
          <div>
            <dt>Slugs</dt>
            <dd>{{ projectStore.slugs.join(', ') || '-' }}</dd>
          </div>
          <div>
            <dt>Nodes</dt>
            <dd>{{ graphStore.stats.nodes }}</dd>
          </div>
          <div>
            <dt>Edges</dt>
            <dd>{{ graphStore.stats.edges }}</dd>
          </div>
          <div>
            <dt>Errors</dt>
            <dd :class="{ 'tni-ok': graphStore.report.errors.length === 0 }">
              {{ graphStore.report.errors.length }}
            </dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd :class="{ 'tni-warn': projectStore.overQuota }">
              {{ projectStore.projectSize }} B
            </dd>
          </div>
        </dl>

        <p v-if="lastError" class="tni-msg tni-err">× {{ lastError }}</p>
        <p v-else-if="lastMessage" class="tni-msg tni-ok">
          ✓ {{ lastMessage }}
        </p>

        <details>
          <summary>Import text (paste TNI v1)</summary>
          <textarea
            v-model="importField"
            rows="6"
            placeholder="!tni v1&#10;floor f1"
          ></textarea>
          <button @click="onImport">import</button>
        </details>

        <details>
          <summary>Canonical text ({{ canonicalText.length }} bytes)</summary>
          <pre class="tni-code">{{ canonicalText }}</pre>
        </details>

        <p class="tni-hint">
          Press <kbd>`</kbd> to open the command palette. Try
          <code>help</code>, <code>add node server db01</code>,
          <code>tag add server db01 Production</code>,
          <code>save demo</code>.
        </p>
      </section>
    </main>
    <CommandPalette />
  </div>
</template>

<style scoped>
.tni-app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--tni-bg);
  color: var(--tni-fg);
  font-family: var(--tni-font-ui);
}
.tni-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 1rem;
  border-bottom: 1px solid var(--tni-border);
  background: var(--tni-bg-elevated);
}
.tni-brand {
  font-weight: 600;
  letter-spacing: 0.02em;
}
.tni-status {
  font-family: var(--tni-font-mono);
  color: var(--tni-fg-muted);
  font-size: 0.85rem;
}
.tni-main {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  overflow: auto;
}
.tni-card {
  background: var(--tni-bg-elevated);
  border: 1px solid var(--tni-border);
  border-radius: var(--tni-radius-lg);
  padding: 1.5rem 2rem;
  max-width: 56rem;
  width: 100%;
  box-shadow: var(--tni-shadow-1);
}
.tni-card h1 {
  margin: 0 0 0.5rem;
  font-size: 1.25rem;
}
.tni-lead {
  margin: 0 0 1.25rem;
  color: var(--tni-fg-muted);
}
.tni-lead code,
.tni-code {
  font-family: var(--tni-font-mono);
  font-size: 0.9em;
}
.tni-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: end;
  margin-bottom: 1rem;
}
.tni-field {
  display: flex;
  flex-direction: column;
  font-size: 0.8rem;
  color: var(--tni-fg-muted);
}
.tni-field input {
  margin-top: 0.2rem;
  padding: 0.35rem 0.5rem;
  background: var(--tni-bg);
  color: var(--tni-fg);
  border: 1px solid var(--tni-border);
  border-radius: var(--tni-radius);
  font-family: var(--tni-font-mono);
  min-width: 10rem;
}
button {
  padding: 0.4rem 0.9rem;
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
.tni-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: 0.75rem 1.5rem;
  margin: 0 0 1rem;
}
.tni-stats div {
  border-left: 2px solid var(--tni-accent);
  padding-left: 0.75rem;
}
.tni-stats dt {
  font-size: 0.8rem;
  color: var(--tni-fg-muted);
}
.tni-stats dd {
  margin: 0.1rem 0 0;
  font-family: var(--tni-font-mono);
  font-size: 1.05rem;
  word-break: break-word;
}
.tni-stats dd.tni-ok {
  color: var(--tni-ok);
}
.tni-stats dd.tni-warn {
  color: var(--tni-warn);
}
.tni-msg {
  margin: 0 0 1rem;
  font-family: var(--tni-font-mono);
  font-size: 0.9rem;
}
.tni-msg.tni-err {
  color: var(--tni-error);
}
.tni-msg.tni-ok {
  color: var(--tni-ok);
}
details {
  margin: 0 0 0.75rem;
}
summary {
  cursor: pointer;
  color: var(--tni-fg-muted);
  font-size: 0.9rem;
}
textarea {
  display: block;
  width: 100%;
  margin-top: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: var(--tni-bg);
  color: var(--tni-fg);
  border: 1px solid var(--tni-border);
  border-radius: var(--tni-radius);
  font-family: var(--tni-font-mono);
  font-size: 0.85rem;
  resize: vertical;
}
.tni-code {
  background: var(--tni-bg);
  border: 1px solid var(--tni-border);
  border-radius: var(--tni-radius);
  padding: 0.75rem 1rem;
  margin-top: 0.5rem;
  line-height: 1.45;
  overflow: auto;
  max-height: 20rem;
}
.tni-hint {
  margin: 0.5rem 0 0;
  color: var(--tni-fg-muted);
  font-size: 0.9rem;
}
kbd {
  background: var(--tni-bg);
  border: 1px solid var(--tni-border);
  border-radius: 4px;
  padding: 0 0.35em;
  font-family: var(--tni-font-mono);
  font-size: 0.9em;
}
</style>
