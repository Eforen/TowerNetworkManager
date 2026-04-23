<!--
  SVG force-directed graph view per docs/specs/visualization.md.

  Phase 6 scope:
    - SVG renderer (canvas fallback deferred until >2000 nodes).
    - d3-force simulation via `GraphLayout`.
    - Pan / zoom (d3-zoom) with scale range [0.1, 8].
    - Node drag (d3-drag) with fx/fy pin while held.
    - Hover tooltip, click -> FSM `clickNode`, shift-click adds to selection.
    - Keyboard: arrows pan, +/- zoom, f fit, g toggle floor layout.
    - Labels faded in above zoom 0.6.
    - Honors `prefers-reduced-motion` (settles once, no reheat on drag).

  Deferred: canvas fallback, analyzer-driven overlays (bottleneck,
  server resources), inspection path highlight, accessibility
  tab-list, and the full tooltip pinout.
-->
<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from 'vue';
import { drag, type D3DragEvent } from 'd3-drag';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, type D3ZoomEvent, type ZoomBehavior } from 'd3-zoom';
import type { Edge, EdgeId, Node as ModelNode, NodeKey } from '@/model';
import {
  useFsmStore,
  useGraphStore,
  useSelectionStore,
} from '@/store';
import {
  edgeDashArray,
  edgeStroke,
  edgeWidth,
  fillVar,
  nodeFamily,
  nodeRadius,
  nodeShape,
  EDGE_VISUALS,
} from './visuals';
import { GraphLayout, type SimLink, type SimNode } from './layout';

const graphStore = useGraphStore();
const fsmStore = useFsmStore();
const selection = useSelectionStore();

const rootRef = ref<HTMLDivElement | null>(null);
const svgRef = ref<SVGSVGElement | null>(null);
const tooltipRef = ref<HTMLDivElement | null>(null);

const layoutMode = ref<'force' | 'floor'>('force');
const zoomLevel = ref(1);
const tx = ref(0);
const ty = ref(0);
const labelsVisible = computed(() => zoomLevel.value >= 0.6);

const layout = new GraphLayout();
const simNodes = shallowRef<SimNode[]>([]);
const simLinks = shallowRef<SimLink[]>([]);
const tickRev = ref(0);

const hoverKey = ref<NodeKey | null>(null);
const hoverEdgeId = ref<EdgeId | null>(null);
const hoverNeighbors = ref<Set<NodeKey>>(new Set());
const tooltipPos = ref({ x: 0, y: 0 });
const tooltipVisible = ref(false);

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let zoomBehavior: ZoomBehavior<SVGSVGElement, unknown> | null = null;
let lastFrame = 0;

// ---------------------------------------------------------------------
// Simulation wiring
// ---------------------------------------------------------------------

layout.sim.on('tick', () => {
  const now = performance.now();
  if (now - lastFrame < 1000 / 60) return;
  lastFrame = now;
  tickRev.value++;
});

function rebuild(): void {
  layout.setGraph(graphStore.graph);
  simNodes.value = [...layout.nodes()];
  simLinks.value = [...layout.links()];
  tickRev.value++;
  if (reducedMotion) {
    for (let i = 0; i < 200; i++) layout.sim.tick();
    layout.pause();
  }
}

watch(
  () => graphStore.revision,
  () => rebuild(),
  { immediate: false },
);

watch(layoutMode, (m) => layout.setMode(m));

// ---------------------------------------------------------------------
// Pan / zoom
// ---------------------------------------------------------------------

function initZoom(): void {
  if (!svgRef.value) return;
  zoomBehavior = zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.1, 8])
    .filter((event: Event) => {
      // Skip zoom/drag when user clicks a node (drag handler owns it).
      const t = event.target as Element | null;
      return !t || !t.closest('[data-sim-node]');
    })
    .on('zoom', (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
      zoomLevel.value = event.transform.k;
      tx.value = event.transform.x;
      ty.value = event.transform.y;
    });
  select(svgRef.value).call(zoomBehavior);
}

function applyZoom(dz: number): void {
  if (!svgRef.value || !zoomBehavior) return;
  zoomBehavior.scaleBy(select(svgRef.value), dz);
}

function fit(): void {
  if (!svgRef.value || !zoomBehavior || simNodes.value.length === 0) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of simNodes.value) {
    if (n.x == null || n.y == null) continue;
    const r = nodeRadius(n.model.type);
    if (n.x - r < minX) minX = n.x - r;
    if (n.y - r < minY) minY = n.y - r;
    if (n.x + r > maxX) maxX = n.x + r;
    if (n.y + r > maxY) maxY = n.y + r;
  }
  if (!Number.isFinite(minX)) return;
  const rect = svgRef.value.getBoundingClientRect();
  const pad = 40;
  const kx = rect.width / Math.max(maxX - minX + pad * 2, 1);
  const ky = rect.height / Math.max(maxY - minY + pad * 2, 1);
  const k = Math.min(kx, ky, 8);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const t = zoomIdentity
    .translate(rect.width / 2, rect.height / 2)
    .scale(k)
    .translate(-cx, -cy);
  zoomBehavior.transform(select(svgRef.value), t);
}

function onDoubleClickBackground(ev: MouseEvent): void {
  if ((ev.target as Element).closest('[data-sim-node]')) return;
  ev.preventDefault();
  fit();
}

// ---------------------------------------------------------------------
// Node drag
// ---------------------------------------------------------------------

function initDrag(): void {
  if (!svgRef.value) return;
  const behavior = drag<SVGGElement, SimNode>()
    .on('start', (event: D3DragEvent<SVGGElement, SimNode, SimNode>, d) => {
      if (!event.active) layout.sim.alphaTarget(reducedMotion ? 0 : 0.3).restart();
      d.fx = d.x ?? 0;
      d.fy = d.y ?? 0;
    })
    .on('drag', (event, d) => {
      d.fx = event.x;
      d.fy = event.y;
    })
    .on('end', (event, d) => {
      if (!event.active) layout.sim.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    });
  select(svgRef.value).selectAll<SVGGElement, SimNode>('[data-sim-node]').call(behavior);
}

// Re-attach drag after nodes mount/change.
watch([simNodes, () => rootRef.value], async () => {
  await nextTick();
  initDrag();
});

// ---------------------------------------------------------------------
// Hover + tooltip
// ---------------------------------------------------------------------

function onNodeEnter(key: NodeKey, ev: MouseEvent): void {
  hoverEdgeId.value = null;
  hoverKey.value = key;
  selection.setHover(key);
  hoverNeighbors.value = computeNeighbors(key);
  tooltipVisible.value = true;
  positionTooltip(ev);
}

function onNodeMove(ev: MouseEvent): void {
  if (tooltipVisible.value) positionTooltip(ev);
}

function onNodeLeave(): void {
  hoverKey.value = null;
  selection.setHover(null);
  hoverNeighbors.value = new Set();
  tooltipVisible.value = false;
}

function onEdgeEnter(l: SimLink, ev: MouseEvent): void {
  // Node hover wins if already active (mouse jumped from node to edge
  // under a crowded layout); clear it so the edge owns the tooltip now.
  hoverKey.value = null;
  selection.setHover(null);
  hoverNeighbors.value = new Set();
  hoverEdgeId.value = l.model.id;
  tooltipVisible.value = true;
  positionTooltip(ev);
}

function onEdgeMove(ev: MouseEvent): void {
  if (tooltipVisible.value) positionTooltip(ev);
}

function onEdgeLeave(): void {
  hoverEdgeId.value = null;
  tooltipVisible.value = false;
}

function positionTooltip(ev: MouseEvent): void {
  if (!rootRef.value || !tooltipRef.value) return;
  const pad = 6;
  const rect = rootRef.value.getBoundingClientRect();
  const tipRect = tooltipRef.value.getBoundingClientRect();
  let x = ev.clientX - rect.left + pad;
  let y = ev.clientY - rect.top + pad;
  if (x + tipRect.width > rect.width) x = ev.clientX - rect.left - tipRect.width - pad;
  if (y + tipRect.height > rect.height) y = ev.clientY - rect.top - tipRect.height - pad;
  tooltipPos.value = { x: Math.max(0, x), y: Math.max(0, y) };
}

function computeNeighbors(key: NodeKey): Set<NodeKey> {
  const out = new Set<NodeKey>();
  for (const l of simLinks.value) {
    const s = typeof l.source === 'object' ? (l.source as SimNode).id : l.source;
    const t = typeof l.target === 'object' ? (l.target as SimNode).id : l.target;
    if (s === key) out.add(t);
    else if (t === key) out.add(s);
  }
  return out;
}

const hoverNode = computed<ModelNode | null>(() => {
  if (!hoverKey.value) return null;
  const n = simNodes.value.find((s) => s.id === hoverKey.value);
  return n ? n.model : null;
});

const hoverEdge = computed<Edge | null>(() => {
  if (!hoverEdgeId.value) return null;
  const l = simLinks.value.find((x) => x.model.id === hoverEdgeId.value);
  return l ? l.model : null;
});

function parseNodeKey(key: NodeKey): { type: string; id: string } {
  const i = key.indexOf(':');
  return { type: key.slice(0, i), id: key.slice(i + 1) };
}

function edgePropEntries(e: Edge): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = [];
  for (const [k, v] of Object.entries(e.properties)) {
    if (v === undefined || v === null || v === '') continue;
    out.push([k, v]);
  }
  return out;
}

// ---------------------------------------------------------------------
// Click / selection
// ---------------------------------------------------------------------

function onNodeClick(key: NodeKey, ev: MouseEvent): void {
  ev.stopPropagation();
  const model = simNodes.value.find((n) => n.id === key)?.model;
  if (!model) return;
  if (ev.shiftKey) {
    selection.toggle(key);
    return;
  }
  selection.set([key]);
  fsmStore.dispatch({ type: 'clickNode', id: model.id });
}

function onBackgroundClick(): void {
  selection.clear();
  fsmStore.dispatch({ type: 'clickBackground' });
}

// ---------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------

function onKeydown(ev: KeyboardEvent): void {
  if (!rootRef.value || document.activeElement !== rootRef.value) return;
  if (ev.key === 'ArrowLeft') panBy(30, 0);
  else if (ev.key === 'ArrowRight') panBy(-30, 0);
  else if (ev.key === 'ArrowUp') panBy(0, 30);
  else if (ev.key === 'ArrowDown') panBy(0, -30);
  else if (ev.key === '+' || ev.key === '=') applyZoom(1.2);
  else if (ev.key === '-' || ev.key === '_') applyZoom(1 / 1.2);
  else if (ev.key === 'f') fit();
  else if (ev.key === 'g') layoutMode.value = layoutMode.value === 'floor' ? 'force' : 'floor';
  else return;
  ev.preventDefault();
}

function panBy(dx: number, dy: number): void {
  if (!svgRef.value || !zoomBehavior) return;
  zoomBehavior.translateBy(select(svgRef.value), dx, dy);
}

// ---------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------

function onVisibility(): void {
  if (document.hidden) layout.pause();
  else if (!reducedMotion) layout.resume(0.1);
}

onMounted(async () => {
  rebuild();
  await nextTick();
  initZoom();
  initDrag();
  document.addEventListener('visibilitychange', onVisibility);
});

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibility);
  layout.destroy();
});

// ---------------------------------------------------------------------
// Rendering helpers (read tickRev to re-run on sim tick)
// ---------------------------------------------------------------------

function nodeTransform(n: SimNode): string {
  void tickRev.value;
  return `translate(${n.x ?? 0} ${n.y ?? 0})`;
}

function linkPath(l: SimLink): string {
  void tickRev.value;
  const s = l.source as SimNode;
  const t = l.target as SimNode;
  const sx = typeof s === 'object' ? s.x ?? 0 : 0;
  const sy = typeof s === 'object' ? s.y ?? 0 : 0;
  const tx2 = typeof t === 'object' ? t.x ?? 0 : 0;
  const ty2 = typeof t === 'object' ? t.y ?? 0 : 0;
  return `M${sx},${sy} L${tx2},${ty2}`;
}

function shapeSymbol(n: SimNode): string {
  const r = nodeRadius(n.model.type);
  switch (nodeShape(n.model.type)) {
    case 'circle':
      return `M${-r},0 a${r},${r} 0 1,0 ${2 * r},0 a${r},${r} 0 1,0 ${-2 * r},0`;
    case 'square':
      return `M${-r},${-r} h${2 * r} v${2 * r} h${-2 * r} z`;
    case 'diamond':
      return `M0,${-r} L${r},0 L0,${r} L${-r},0 z`;
    case 'hexagon': {
      const s = r;
      const w = s * Math.cos(Math.PI / 6);
      return `M${-s / 2},${-w} L${s / 2},${-w} L${s},0 L${s / 2},${w} L${-s / 2},${w} L${-s},0 z`;
    }
    case 'roundedRect': {
      const w = r * 1.6, h = r * 1.1;
      return `M${-w},${-h} h${2 * w} a6,6 0 0 1 6,6 v${2 * h - 12} a6,6 0 0 1 -6,6 h${-2 * w} a6,6 0 0 1 -6,-6 v${-2 * h + 12} a6,6 0 0 1 6,-6 z`;
    }
    case 'pill':
    case 'pillNumber': {
      const w = r * 1.8, h = r * 0.9;
      return `M${-w + h},${-h} h${2 * (w - h)} a${h},${h} 0 0 1 0,${2 * h} h${-2 * (w - h)} a${h},${h} 0 0 1 0,${-2 * h} z`;
    }
    case 'cloud': {
      const s = r;
      return `M${-s},0 q0,${-s} ${s},${-s} q${s},0 ${s},${s} q0,${s} ${-s},${s} q${-s},0 ${-s},${-s} z`;
    }
  }
}

function nodeLabel(n: ModelNode): string {
  const name = n.properties['name'];
  return typeof name === 'string' && name.length > 0 ? name : n.id;
}

function dimmed(key: NodeKey): boolean {
  if (!hoverKey.value) return false;
  if (hoverKey.value === key) return false;
  return !hoverNeighbors.value.has(key);
}

function edgeDimmed(l: SimLink): boolean {
  if (!hoverKey.value) return false;
  const s = typeof l.source === 'object' ? (l.source as SimNode).id : l.source;
  const t = typeof l.target === 'object' ? (l.target as SimNode).id : l.target;
  return s !== hoverKey.value && t !== hoverKey.value;
}

function selected(key: NodeKey): boolean {
  return selection.isSelected(key);
}

function edgeStrokeStyle(e: Edge): string {
  return `var(${edgeStroke(e.relation)})`;
}

function edgeBadge(e: Edge): string | null {
  if (e.relation !== 'Consumes' && e.relation !== 'Provides') return null;
  const pool = e.properties['pool'];
  if (typeof pool === 'string' && pool.length > 0) return pool;
  const req = e.properties['required'];
  if (typeof req === 'number') return String(req);
  const amt = e.properties['amount'];
  if (typeof amt === 'number') return String(amt);
  return null;
}

function edgeMidpoint(l: SimLink): { x: number; y: number } {
  void tickRev.value;
  const s = l.source as SimNode;
  const t = l.target as SimNode;
  const sx = typeof s === 'object' ? s.x ?? 0 : 0;
  const sy = typeof s === 'object' ? s.y ?? 0 : 0;
  const tx2 = typeof t === 'object' ? t.x ?? 0 : 0;
  const ty2 = typeof t === 'object' ? t.y ?? 0 : 0;
  return { x: (sx + tx2) / 2, y: (sy + ty2) / 2 };
}

function nodeFill(n: ModelNode): string {
  return `var(${fillVar(nodeFamily(n.type))})`;
}

function hasArrow(e: Edge): boolean {
  return EDGE_VISUALS[e.relation]?.arrowhead ?? false;
}

function dashForEdge(e: Edge): string | undefined {
  const v = EDGE_VISUALS[e.relation];
  return v ? edgeDashArray(v.dash) : undefined;
}

// Expose for tests.
defineExpose({ layout, simNodes, simLinks });
</script>

<template>
  <div
    ref="rootRef"
    class="tni-graph"
    tabindex="0"
    role="application"
    aria-label="Network graph"
    @click="onBackgroundClick"
    @dblclick="onDoubleClickBackground"
    @keydown="onKeydown"
  >
    <svg
      ref="svgRef"
      class="tni-graph__svg"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <marker
          v-for="rel in Object.keys(EDGE_VISUALS)"
          :id="`arrow-${rel}`"
          :key="rel"
          viewBox="0 -4 8 8"
          refX="8"
          refY="0"
          markerWidth="6"
          markerHeight="6"
          orient="auto"
        >
          <path d="M0,-4 L8,0 L0,4 z" :fill="`var(${EDGE_VISUALS[rel as keyof typeof EDGE_VISUALS].strokeVar})`" />
        </marker>
      </defs>
      <g :transform="`translate(${tx} ${ty}) scale(${zoomLevel})`">
        <g class="tni-graph__edges">
          <g
            v-for="l in simLinks"
            :key="l.id"
            :class="{
              dimmed: edgeDimmed(l),
              hover: hoverEdgeId === l.model.id,
            }"
          >
            <!-- Fat invisible stroke catches the pointer so hovering a
                 thin edge is easy. Sits under the visible path. -->
            <path
              class="tni-graph__edge-hit"
              :d="linkPath(l)"
              stroke="transparent"
              stroke-width="14"
              fill="none"
              @mouseenter="onEdgeEnter(l, $event)"
              @mousemove="onEdgeMove"
              @mouseleave="onEdgeLeave"
            />
            <path
              class="tni-graph__edge"
              :d="linkPath(l)"
              :stroke="edgeStrokeStyle(l.model)"
              :stroke-width="edgeWidth(l.model.relation, l.model.strength)"
              :stroke-dasharray="dashForEdge(l.model)"
              fill="none"
              :marker-end="hasArrow(l.model) ? `url(#arrow-${l.model.relation})` : undefined"
            />
            <text
              v-if="edgeBadge(l.model)"
              :x="edgeMidpoint(l).x"
              :y="edgeMidpoint(l).y"
              class="tni-graph__edge-badge"
            >
              {{ edgeBadge(l.model) }}
            </text>
          </g>
        </g>
        <g class="tni-graph__nodes">
          <g
            v-for="n in simNodes"
            :key="n.id"
            data-sim-node
            :transform="nodeTransform(n)"
            :class="{
              selected: selected(n.id),
              dimmed: dimmed(n.id),
              hover: hoverKey === n.id,
              neighbor: hoverNeighbors.has(n.id),
            }"
            @mouseenter="onNodeEnter(n.id, $event)"
            @mousemove="onNodeMove"
            @mouseleave="onNodeLeave"
            @click="onNodeClick(n.id, $event)"
          >
            <path
              :d="shapeSymbol(n)"
              :fill="nodeFill(n.model)"
              class="tni-graph__node-shape"
            />
            <text
              v-if="labelsVisible"
              class="tni-graph__label"
              :y="nodeRadius(n.model.type) + 12"
            >
              {{ nodeLabel(n.model) }}
            </text>
          </g>
        </g>
      </g>
    </svg>
    <div
      ref="tooltipRef"
      class="tni-graph__tooltip"
      :class="{ visible: tooltipVisible }"
      :style="{ left: `${tooltipPos.x}px`, top: `${tooltipPos.y}px` }"
    >
      <template v-if="hoverNode">
        <div class="tni-tip__head">
          <span class="tni-tip__type">{{ hoverNode.type }}</span>
          <span class="tni-tip__sep">·</span>
          <span class="tni-tip__id">{{ hoverNode.id }}</span>
        </div>
        <div v-if="hoverNode.properties['name']" class="tni-tip__name">
          {{ hoverNode.properties['name'] }}
        </div>
        <div v-if="hoverNode.tags.length > 0" class="tni-tip__tags">
          <span v-for="t in hoverNode.tags" :key="t" class="tni-tip__tag">{{ t }}</span>
        </div>
        <div class="tni-tip__footer">
          neighbors: {{ hoverNeighbors.size }}
        </div>
      </template>
      <template v-else-if="hoverEdge">
        <div class="tni-tip__head">
          <span class="tni-tip__type">{{ hoverEdge.relation }}</span>
          <span class="tni-tip__sep">·</span>
          <span class="tni-tip__id">{{ hoverEdge.directed ? 'directed' : 'undirected' }}</span>
        </div>
        <div class="tni-tip__edge-endpoints">
          <span class="tni-tip__endpoint">
            <span class="tni-tip__type">{{ parseNodeKey(hoverEdge.fromKey).type }}</span>
            <span class="tni-tip__sep">[</span>
            <span class="tni-tip__id">{{ parseNodeKey(hoverEdge.fromKey).id }}</span>
            <span class="tni-tip__sep">]</span>
          </span>
          <span class="tni-tip__edge-arrow">{{ hoverEdge.directed ? '→' : '↔' }}</span>
          <span class="tni-tip__endpoint">
            <span class="tni-tip__type">{{ parseNodeKey(hoverEdge.toKey).type }}</span>
            <span class="tni-tip__sep">[</span>
            <span class="tni-tip__id">{{ parseNodeKey(hoverEdge.toKey).id }}</span>
            <span class="tni-tip__sep">]</span>
          </span>
        </div>
        <div
          v-if="edgePropEntries(hoverEdge).length > 0"
          class="tni-tip__tags"
        >
          <span
            v-for="[k, v] in edgePropEntries(hoverEdge)"
            :key="k"
            class="tni-tip__tag"
          >{{ k }}={{ v }}</span>
        </div>
        <div class="tni-tip__footer">
          strength: {{ hoverEdge.strength.toFixed(2) }}
        </div>
      </template>
    </div>
    <div class="tni-graph__hud">
      <span>{{ simNodes.length }} nodes · {{ simLinks.length }} edges</span>
      <span>zoom {{ zoomLevel.toFixed(2) }}</span>
      <span>layout: {{ layoutMode }}</span>
      <span class="tni-graph__keys">
        <kbd>f</kbd> fit · <kbd>g</kbd> floors · <kbd>+</kbd>/<kbd>-</kbd> zoom · <kbd>arrows</kbd> pan
      </span>
    </div>
  </div>
</template>

<style scoped>
.tni-graph {
  position: relative;
  flex: 1;
  min-height: 0;
  background: var(--tni-bg);
  overflow: hidden;
  outline: none;
}

.tni-graph:focus-visible {
  box-shadow: inset 0 0 0 2px var(--tni-accent);
}

.tni-graph__svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  cursor: grab;
}

.tni-graph__svg:active {
  cursor: grabbing;
}

.tni-graph__node-shape {
  stroke: var(--tni-fg-muted);
  stroke-width: 1;
  transition: opacity 120ms ease;
}

.tni-graph__nodes g {
  cursor: pointer;
}

.tni-graph__nodes g.hover .tni-graph__node-shape {
  stroke: var(--tni-accent);
  stroke-width: 2;
}

.tni-graph__nodes g.selected .tni-graph__node-shape {
  stroke: var(--tni-accent);
  stroke-width: 2.5;
}

.tni-graph__nodes g.dimmed {
  opacity: 0.3;
}

.tni-graph__edges g.dimmed {
  opacity: 0.2;
}

/* Invisible hit path: catches pointer events so hovering a thin edge is
   reliable. The visible edge is painted on top. */
.tni-graph__edge-hit {
  cursor: pointer;
  pointer-events: stroke;
}

.tni-graph__edge {
  pointer-events: none;
  transition: stroke-width 80ms ease;
}

.tni-graph__edges g.hover .tni-graph__edge {
  stroke-width: 3px;
  filter: drop-shadow(0 0 3px var(--tni-accent, #4a9eff));
}

.tni-graph__label {
  fill: var(--tni-fg);
  font-family: var(--tni-font-ui);
  font-size: 10px;
  text-anchor: middle;
  pointer-events: none;
}

.tni-graph__edge-badge {
  fill: var(--tni-fg-muted);
  font-family: var(--tni-font-mono);
  font-size: 9px;
  text-anchor: middle;
  pointer-events: none;
}

.tni-graph__tooltip {
  position: absolute;
  pointer-events: none;
  opacity: 0;
  transform: translateY(2px);
  transition: opacity 80ms ease, transform 80ms ease;
  background: var(--tni-bg-elevated);
  color: var(--tni-fg);
  border: 1px solid var(--tni-border);
  border-radius: var(--tni-radius);
  padding: 0.5rem 0.75rem;
  font-size: 0.8rem;
  max-width: 20rem;
  box-shadow: var(--tni-shadow-2);
  z-index: 5;
}

.tni-graph__tooltip.visible {
  opacity: 1;
  transform: translateY(0);
}

.tni-tip__head {
  font-family: var(--tni-font-mono);
  display: flex;
  gap: 0.35rem;
  align-items: baseline;
}

.tni-tip__type {
  color: var(--tni-accent);
  font-weight: 600;
}

.tni-tip__sep {
  color: var(--tni-fg-muted);
}

.tni-tip__id {
  color: var(--tni-fg);
}

.tni-tip__name {
  margin-top: 0.25rem;
}

.tni-tip__tags {
  margin-top: 0.35rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.tni-tip__tag {
  font-size: 0.7rem;
  background: var(--tni-bg);
  color: var(--tni-fg-muted);
  padding: 0.05rem 0.35rem;
  border: 1px solid var(--tni-border);
  border-radius: 999px;
}

.tni-tip__footer {
  margin-top: 0.35rem;
  color: var(--tni-fg-muted);
  font-size: 0.72rem;
}

.tni-tip__edge-endpoints {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem;
  margin-top: 0.25rem;
}

.tni-tip__endpoint {
  display: inline-flex;
  align-items: baseline;
  font-family: var(--tni-font-mono);
  font-size: 0.75rem;
}

.tni-tip__edge-arrow {
  color: var(--tni-fg-muted);
  font-weight: 600;
}

.tni-graph__hud {
  position: absolute;
  bottom: 0.5rem;
  left: 0.75rem;
  right: 0.75rem;
  display: flex;
  gap: 1rem;
  font-family: var(--tni-font-mono);
  font-size: 0.75rem;
  color: var(--tni-fg-muted);
  pointer-events: none;
}

.tni-graph__keys {
  margin-left: auto;
}

.tni-graph__keys kbd {
  background: var(--tni-bg-elevated);
  border: 1px solid var(--tni-border);
  border-radius: 3px;
  padding: 0 0.25rem;
  font-size: 0.7rem;
}
</style>
