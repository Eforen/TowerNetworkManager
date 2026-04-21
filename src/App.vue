<script setup lang="ts">
import { computed } from 'vue';
import { Graph, validate } from '@/model';

/**
 * Smoke demo: build a tiny graph in-browser so the model is exercised
 * outside of Node tests and we can surface counts + validation in the UI.
 * Goes away once a real project store (Phase 3) drives the view.
 */
function buildDemoGraph(): Graph {
  const g = new Graph();
  g.addNode({ type: 'floor', id: 'f1' });
  g.addNode({ type: 'rack', id: 'r1' });
  g.addNode({ type: 'switch', id: 'sw1' });
  g.addNode({ type: 'server', id: 'db01' });
  g.addNode({ type: 'port', id: '@f1/s/1', tags: ['RJ45'] });
  g.addNode({ type: 'port', id: '@f1/c/1', tags: ['RJ45', 'UserPort'] });
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
  return g;
}

const graph = buildDemoGraph();
const stats = graph.stats();
const report = validate(graph);

const serverFloor = computed(() => graph.floorOf('server', 'db01'));
const customerFloor = computed(() => graph.floorOf('port', '@f1/c/1'));
</script>

<template>
  <div class="tni-app">
    <header class="tni-topbar">
      <span class="tni-brand">Tower Networking Inc</span>
      <span class="tni-status">Phase 1 model</span>
    </header>
    <main class="tni-main">
      <section class="tni-card">
        <h1>Graph data model smoke test</h1>
        <p class="tni-lead">
          A seven-node demo graph is built in the browser on load. Real
          graph view lands in Phase 6.
        </p>
        <dl class="tni-stats">
          <div>
            <dt>Nodes</dt>
            <dd>{{ stats.nodes }}</dd>
          </div>
          <div>
            <dt>Edges</dt>
            <dd>{{ stats.edges }}</dd>
          </div>
          <div>
            <dt>Errors</dt>
            <dd :class="{ 'tni-ok': report.errors.length === 0 }">
              {{ report.errors.length }}
            </dd>
          </div>
          <div>
            <dt>Warnings</dt>
            <dd>{{ report.warnings.length }}</dd>
          </div>
          <div>
            <dt>Floor of db01</dt>
            <dd>{{ serverFloor ?? '-' }}</dd>
          </div>
          <div>
            <dt>Floor of @f1/c/1</dt>
            <dd>{{ customerFloor ?? '-' }}</dd>
          </div>
        </dl>
        <p class="tni-hint">
          Press <kbd>`</kbd> to open the command palette (not yet
          implemented).
        </p>
      </section>
    </main>
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
}
.tni-card {
  background: var(--tni-bg-elevated);
  border: 1px solid var(--tni-border);
  border-radius: var(--tni-radius-lg);
  padding: 1.5rem 2rem;
  max-width: 44rem;
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
.tni-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  gap: 0.75rem 1.5rem;
  margin: 0 0 1.25rem;
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
  font-size: 1.1rem;
}
.tni-stats dd.tni-ok {
  color: var(--tni-ok);
}
.tni-hint {
  margin: 0;
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
