<!--
  SVG force-directed graph view per docs/specs/visualization.md.

  Phase 6 scope:
    - SVG renderer (canvas fallback deferred until >2000 nodes).
    - d3-force simulation via `GraphLayout`.
    - Pan / zoom (d3-zoom) with scale range [0.1, 8].
    - Node drag (pointer events + d3.pointer in viewport space) with fx/fy pin while held.
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
import { STORAGE_KEYS, defaultStorage } from '@/store/storage';
import { pointer, select } from 'd3-selection';
import { zoom, zoomIdentity, type D3ZoomEvent, type ZoomBehavior } from 'd3-zoom';
import { nodeKey } from '@/model';
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
import {
  buildPresentationGraph,
  collapsedChildPresentationTargets,
  collapsedChildrenForParent,
  DEFAULT_DATA_LAYERS,
  parseDataLayersJson,
  type DataLayersSettings,
} from './presentationGraph';

const graphStore = useGraphStore();
const fsmStore = useFsmStore();
const selection = useSelectionStore();

const rootRef = ref<HTMLDivElement | null>(null);
const svgRef = ref<SVGSVGElement | null>(null);
/** Pan/zoom layer; d3.pointer(..., el) must use this so coords match `n.x`/`n.y`. */
const viewportRef = ref<SVGGElement | null>(null);
/** Primary panel (node or edge) — used to clamp tooltip position. */
const tooltipPanelRef = ref<HTMLDivElement | null>(null);

const layoutMode = ref<'force' | 'floor'>('force');
const zoomLevel = ref(1);
const tx = ref(0);
const ty = ref(0);
const labelsVisible = computed(() => zoomLevel.value >= 0.6);

const layout = new GraphLayout();
const simNodes = shallowRef<SimNode[]>([]);
const simLinks = shallowRef<SimLink[]>([]);
const tickRev = ref(0);

const dataLayers = ref<DataLayersSettings>(loadDataLayers());
const dataLayersMenuOpen = ref(false);

function loadDataLayers(): DataLayersSettings {
  try {
    return parseDataLayersJson(
      defaultStorage().getItem(STORAGE_KEYS.viewDataLayers),
    );
  } catch {
    return { ...DEFAULT_DATA_LAYERS };
  }
}

function persistDataLayers(v: DataLayersSettings): void {
  try {
    defaultStorage().setItem(STORAGE_KEYS.viewDataLayers, JSON.stringify(v));
  } catch {
    /* ignore quota / private mode */
  }
}

function toggleDataLayer<K extends keyof DataLayersSettings>(key: K): void {
  dataLayers.value = { ...dataLayers.value, [key]: !dataLayers.value[key] };
}

const hoverKey = ref<NodeKey | null>(null);
const hoverEdgeId = ref<EdgeId | null>(null);
const hoverNeighbors = ref<Set<NodeKey>>(new Set());
const tooltipPos = ref({ x: 0, y: 0 });
const tooltipVisible = ref(false);
/** Pinned with Shift: fixed position + pointer hit on tooltip stack until dismiss. */
const tooltipPinned = ref(false);
const tooltipStackRef = ref<HTMLDivElement | null>(null);
const pointerOverGraphNode = ref(false);
const lastPointerClient = ref({ x: 0, y: 0 });
const highlightCollapsedChildKey = ref<NodeKey | null>(null);
const linkAnchorEl = ref<HTMLElement | null>(null);
const childLinkLines = shallowRef<
  Array<{ x1: number; y1: number; x2: number; y2: number }>
>([]);
const childTipOffset = ref({ left: 0, top: 0 });

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let zoomBehavior: ZoomBehavior<SVGSVGElement, unknown> | null = null;
let lastFrame = 0;
const suppressNodeClick = ref(false);
/** Cancels window pointer listeners if the view unmounts mid-drag. */
let cancelPointerDrag: (() => void) | null = null;

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
  layout.setGraph(
    buildPresentationGraph(graphStore.graph, dataLayers.value),
  );
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
  { immediate: true },
);

watch(
  dataLayers,
  (v) => {
    persistDataLayers(v);
    rebuild();
  },
  { deep: true },
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
      return (
        (!t || !t.closest('[data-sim-node]')) &&
        (!t || !t.closest('[data-tni-toolbar]')) &&
        (!t || !t.closest('[data-tni-tooltip-stack]'))
      );
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
  const t = ev.target as Element;
  if (t.closest('[data-sim-node]') || t.closest('[data-tni-toolbar]')) return;
  ev.preventDefault();
  fit();
}

// ---------------------------------------------------------------------
// Node drag (pointer + d3.pointer; avoids d3-drag vs Vue DOM churn)
// ---------------------------------------------------------------------

function onNodePointerDown(key: NodeKey, ev: PointerEvent): void {
  if (ev.button !== 0) return;
  const container = viewportRef.value;
  const node = layout.nodes().find((n) => n.id === key);
  if (!container || !node) return;
  const simNode = node;

  ev.stopPropagation();

  cancelPointerDrag?.();
  let movedDuringDrag = false;

  if (!reducedMotion) layout.sim.alphaTarget(0.2).restart();

  const [px0, py0] = pointer(ev, container);
  const nx = simNode.x ?? 0;
  const ny = simNode.y ?? 0;
  const ox = px0 - nx;
  const oy = py0 - ny;

  function applyWorld(wx: number, wy: number): void {
    const x = wx - ox;
    const y = wy - oy;
    simNode.fx = x;
    simNode.fy = y;
    simNode.x = x;
    simNode.y = y;
    tickRev.value++;
  }

  function move(e: PointerEvent): void {
    if (e.pointerId !== ev.pointerId) return;
    movedDuringDrag = true;
    suppressNodeClick.value = true;
    const [wx, wy] = pointer(e, container);
    applyWorld(wx, wy);
  }

  function end(e: PointerEvent): void {
    if (e.pointerId !== ev.pointerId) return;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    cancelPointerDrag = null;

    layout.sim.alphaTarget(0);
    simNode.fx = null;
    simNode.fy = null;
    tickRev.value++;

    if (movedDuringDrag) {
      queueMicrotask(() => {
        suppressNodeClick.value = false;
      });
    } else {
      suppressNodeClick.value = false;
    }
  }

  cancelPointerDrag = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    cancelPointerDrag = null;
    layout.sim.alphaTarget(0);
    simNode.fx = null;
    simNode.fy = null;
    tickRev.value++;
    suppressNodeClick.value = false;
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}

// ---------------------------------------------------------------------
// Hover + tooltip
// ---------------------------------------------------------------------

function resetCollapsedTooltipInspect(): void {
  highlightCollapsedChildKey.value = null;
  linkAnchorEl.value = null;
  childLinkLines.value = [];
}

function onNodeEnter(key: NodeKey, ev: MouseEvent): void {
  hoverEdgeId.value = null;
  tooltipPinned.value = false;
  resetCollapsedTooltipInspect();
  hoverKey.value = key;
  pointerOverGraphNode.value = true;
  selection.setHover(key);
  hoverNeighbors.value = computeNeighbors(key);
  tooltipVisible.value = true;
  lastPointerClient.value = { x: ev.clientX, y: ev.clientY };
  positionTooltip(ev);
}

function onNodeMove(ev: MouseEvent): void {
  lastPointerClient.value = { x: ev.clientX, y: ev.clientY };
  if (tooltipVisible.value && !tooltipPinned.value) {
    positionTooltip(ev);
  }
}

function onNodeLeave(): void {
  pointerOverGraphNode.value = false;
  if (tooltipPinned.value) return;
  hoverKey.value = null;
  selection.setHover(null);
  hoverNeighbors.value = new Set();
  resetCollapsedTooltipInspect();
  tooltipVisible.value = false;
}

function onEdgeEnter(l: SimLink, ev: MouseEvent): void {
  // Node hover wins if already active (mouse jumped from node to edge
  // under a crowded layout); clear it so the edge owns the tooltip now.
  tooltipPinned.value = false;
  resetCollapsedTooltipInspect();
  hoverKey.value = null;
  pointerOverGraphNode.value = false;
  selection.setHover(null);
  hoverNeighbors.value = new Set();
  hoverEdgeId.value = l.model.id;
  tooltipVisible.value = true;
  lastPointerClient.value = { x: ev.clientX, y: ev.clientY };
  positionTooltip(ev);
}

function onEdgeMove(ev: MouseEvent): void {
  if (tooltipVisible.value) positionTooltip(ev);
}

function onEdgeLeave(): void {
  hoverEdgeId.value = null;
  tooltipVisible.value = false;
}

function positionTooltipAtClient(clientX: number, clientY: number): void {
  if (!rootRef.value || !tooltipPanelRef.value) return;
  const pad = 6;
  const rect = rootRef.value.getBoundingClientRect();
  const tipRect = tooltipPanelRef.value.getBoundingClientRect();
  let x = clientX - rect.left + pad;
  let y = clientY - rect.top + pad;
  if (x + tipRect.width > rect.width) {
    x = clientX - rect.left - tipRect.width - pad;
  }
  if (y + tipRect.height > rect.height) {
    y = clientY - rect.top - tipRect.height - pad;
  }
  tooltipPos.value = { x: Math.max(0, x), y: Math.max(0, y) };
}

function positionTooltip(ev: MouseEvent): void {
  positionTooltipAtClient(ev.clientX, ev.clientY);
}

function clientToViewportLocal(
  clientX: number,
  clientY: number,
): { x: number; y: number } | null {
  const svg = svgRef.value;
  const g = viewportRef.value;
  if (!svg || !g) return null;
  const ctm = g.getScreenCTM();
  if (!ctm) return null;
  const p = new DOMPoint(clientX, clientY);
  const loc = p.matrixTransform(ctm.inverse());
  return { x: loc.x, y: loc.y };
}

function updateChildLinkLines(): void {
  void tickRev.value;
  const childK = highlightCollapsedChildKey.value;
  const anchor = linkAnchorEl.value;
  if (!childK || !anchor || !svgRef.value || !viewportRef.value) {
    childLinkLines.value = [];
    return;
  }
  const rect = anchor.getBoundingClientRect();
  const sx = rect.left + rect.width / 2;
  const sy = rect.top + rect.height / 2;
  const start = clientToViewportLocal(sx, sy);
  if (!start) {
    childLinkLines.value = [];
    return;
  }
  const targets = collapsedChildPresentationTargets(
    graphStore.graph,
    dataLayers.value,
    childK,
  );
  const lines: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  for (const tk of targets) {
    const sn = simNodes.value.find((s) => s.id === tk);
    if (!sn || sn.x == null || sn.y == null) continue;
    lines.push({
      x1: start.x,
      y1: start.y,
      x2: sn.x,
      y2: sn.y,
    });
  }
  childLinkLines.value = lines;
}

function onWindowShiftPin(ev: KeyboardEvent): void {
  if (ev.key !== 'Shift' || ev.repeat) return;
  if (!pointerOverGraphNode.value || !hoverKey.value || !tooltipVisible.value) return;
  if (hoverCollapsedChildren.value.length === 0) return;
  tooltipPinned.value = true;
  positionTooltipAtClient(
    lastPointerClient.value.x,
    lastPointerClient.value.y,
  );
  void nextTick(() => updateChildLinkLines());
}

function dismissPinnedTooltip(): void {
  if (!tooltipPinned.value && !highlightCollapsedChildKey.value) return;
  tooltipPinned.value = false;
  resetCollapsedTooltipInspect();
  if (!pointerOverGraphNode.value) {
    hoverKey.value = null;
    hoverEdgeId.value = null;
    selection.setHover(null);
    hoverNeighbors.value = new Set();
    tooltipVisible.value = false;
  }
}

function onWindowEscape(ev: KeyboardEvent): void {
  if (ev.key !== 'Escape') return;
  if (tooltipPinned.value || highlightCollapsedChildKey.value) {
    ev.preventDefault();
    dismissPinnedTooltip();
  }
}

function onTooltipStackPointerLeave(ev: PointerEvent): void {
  const rel = ev.relatedTarget as Node | null;
  if (rel && tooltipStackRef.value?.contains(rel)) return;
  if (rel && (rel as Element).closest?.('[data-sim-node]')) return;
  resetCollapsedTooltipInspect();
  if (tooltipPinned.value) {
    tooltipPinned.value = false;
  }
  if (!pointerOverGraphNode.value) {
    hoverKey.value = null;
    hoverEdgeId.value = null;
    selection.setHover(null);
    hoverNeighbors.value = new Set();
    tooltipVisible.value = false;
  }
}

function onCollapsedRowEnter(c: ModelNode, ev: MouseEvent): void {
  if (!tooltipPinned.value) return;
  const row = ev.currentTarget as HTMLElement;
  const stack = tooltipStackRef.value;
  if (!stack) return;
  const rs = row.getBoundingClientRect();
  const st = stack.getBoundingClientRect();
  highlightCollapsedChildKey.value = nodeKey(c.type, c.id);
  linkAnchorEl.value = row.querySelector('.tni-tip__collapsed-icon-cell');
  childTipOffset.value = {
    left: stack.offsetWidth + 6,
    top: rs.top - st.top,
  };
  void nextTick(() => updateChildLinkLines());
}

function onCollapsedRowLeave(ev: MouseEvent): void {
  const rel = ev.relatedTarget as Node | null;
  if (rel && tooltipStackRef.value?.contains(rel)) return;
  highlightCollapsedChildKey.value = null;
  linkAnchorEl.value = null;
  childLinkLines.value = [];
}

function onChildTooltipPointerLeave(ev: MouseEvent): void {
  const rel = ev.relatedTarget as Node | null;
  if (rel && tooltipStackRef.value?.contains(rel)) return;
  highlightCollapsedChildKey.value = null;
  linkAnchorEl.value = null;
  childLinkLines.value = [];
}

watch(
  () => [
    tickRev.value,
    highlightCollapsedChildKey.value,
    tooltipPos.value.x,
    tooltipPos.value.y,
    graphStore.revision,
  ],
  () => {
    if (highlightCollapsedChildKey.value) {
      void nextTick(() => updateChildLinkLines());
    }
  },
);

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

/** Full-graph nodes hidden by data-layer collapse but grouped under hovered node. */
const hoverCollapsedChildren = computed<ModelNode[]>(() => {
  if (!hoverKey.value) return [];
  return collapsedChildrenForParent(
    graphStore.graph,
    dataLayers.value,
    hoverKey.value,
  );
});

const collapsedTargetsByChildKey = computed(() => {
  const g = graphStore.graph;
  const layers = dataLayers.value;
  const m = new Map<string, NodeKey[]>();
  for (const c of hoverCollapsedChildren.value) {
    const ck = nodeKey(c.type, c.id);
    m.set(ck, collapsedChildPresentationTargets(g, layers, ck));
  }
  return m;
});

function collapsedTargetsFor(c: ModelNode): NodeKey[] {
  return collapsedTargetsByChildKey.value.get(nodeKey(c.type, c.id)) ?? [];
}

const hoverEdge = computed<Edge | null>(() => {
  if (!hoverEdgeId.value) return null;
  const l = simLinks.value.find((x) => x.model.id === hoverEdgeId.value);
  return l ? l.model : null;
});

function parseNodeKey(key: NodeKey): { type: string; id: string } {
  const i = key.indexOf(':');
  return { type: key.slice(0, i), id: key.slice(i + 1) };
}

const highlightCollapsedChildModel = computed<ModelNode | null>(() => {
  const k = highlightCollapsedChildKey.value;
  if (!k) return null;
  const p = parseNodeKey(k);
  return graphStore.graph.getNode(p.type as ModelNode['type'], p.id) ?? null;
});

/** Presentation targets for the highlighted collapsed child (full `Node` models). */
const highlightCollapsedChildLinkTargets = computed<ModelNode[]>(() => {
  const k = highlightCollapsedChildKey.value;
  if (!k) return [];
  const keys = collapsedChildPresentationTargets(
    graphStore.graph,
    dataLayers.value,
    k,
  );
  const out: ModelNode[] = [];
  for (const nk of keys) {
    const p = parseNodeKey(nk);
    const n = graphStore.graph.getNode(p.type as ModelNode['type'], p.id);
    if (n) out.push(n);
  }
  return out;
});

/** Primary collapsed node, then each link target with a LINK / ALSO bridge label. */
interface ChildTooltipSection {
  node: ModelNode;
  before?: 'LINK' | 'ALSO';
}

const childTooltipSections = computed<ChildTooltipSection[]>(() => {
  const primary = highlightCollapsedChildModel.value;
  if (!primary) return [];
  const links = highlightCollapsedChildLinkTargets.value;
  const out: ChildTooltipSection[] = [{ node: primary }];
  for (let i = 0; i < links.length; i++) {
    out.push({
      node: links[i]!,
      before: i === 0 ? 'LINK' : 'ALSO',
    });
  }
  return out;
});

const childLinkTargetKeys = computed(() => {
  const k = highlightCollapsedChildKey.value;
  if (!k) return new Set<NodeKey>();
  return new Set(
    collapsedChildPresentationTargets(
      graphStore.graph,
      dataLayers.value,
      k,
    ),
  );
});

const tooltipStackInteractive = computed(
  () => tooltipPinned.value || highlightCollapsedChildKey.value != null,
);

function edgePropEntries(e: Edge): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = [];
  for (const [k, v] of Object.entries(e.properties)) {
    if (v === undefined || v === null || v === '') continue;
    out.push([k, v]);
  }
  return out;
}

/** Tooltip: show non-empty node properties (name is already in the header line). */
function nodePropEntries(n: ModelNode): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = [];
  for (const [k, v] of Object.entries(n.properties)) {
    if (v === undefined || v === null || v === '') continue;
    if (k === 'name') continue;
    out.push([k, v]);
  }
  out.sort((a, b) => a[0].localeCompare(b[0]));
  return out;
}

// ---------------------------------------------------------------------
// Click / selection
// ---------------------------------------------------------------------

function onNodeClick(key: NodeKey, ev: MouseEvent): void {
  ev.stopPropagation();
  if (ev.defaultPrevented || suppressNodeClick.value) return;
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
  tooltipPinned.value = false;
  resetCollapsedTooltipInspect();
  hoverKey.value = null;
  hoverEdgeId.value = null;
  pointerOverGraphNode.value = false;
  selection.setHover(null);
  tooltipVisible.value = false;
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

function onWindowTooltipKeys(ev: KeyboardEvent): void {
  onWindowShiftPin(ev);
  onWindowEscape(ev);
}

onMounted(async () => {
  await nextTick();
  initZoom();
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('keydown', onWindowTooltipKeys);
});

onBeforeUnmount(() => {
  cancelPointerDrag?.();
  document.removeEventListener('visibilitychange', onVisibility);
  window.removeEventListener('keydown', onWindowTooltipKeys);
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
  if (highlightCollapsedChildKey.value && childLinkTargetKeys.value.has(key)) {
    return false;
  }
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
    <div
      class="tni-graph__toolbar"
      data-tni-toolbar
      @pointerdown.stop
    >
      <div class="tni-graph__tool-row">
        <button
          type="button"
          class="tni-graph__tool-btn"
          :class="{ 'tni-graph__tool-btn--on': dataLayersMenuOpen }"
          :aria-expanded="dataLayersMenuOpen"
          aria-haspopup="true"
          aria-controls="tni-data-layers-menu"
          @click="dataLayersMenuOpen = !dataLayersMenuOpen"
        >
          Data layers
        </button>
        <div
          v-if="dataLayersMenuOpen"
          id="tni-data-layers-menu"
          class="tni-graph__flyout"
          role="menu"
          aria-label="Data layers"
        >
          <button
            type="button"
            class="tni-graph__flyout-btn"
            role="menuitemcheckbox"
            :aria-pressed="dataLayers.showFloors"
            @click="toggleDataLayer('showFloors')"
          >
            Floors
          </button>
          <button
            type="button"
            class="tni-graph__flyout-btn"
            role="menuitemcheckbox"
            :aria-pressed="dataLayers.collapseNetworkAddresses"
            @click="toggleDataLayer('collapseNetworkAddresses')"
          >
            Network addresses
          </button>
          <button
            type="button"
            class="tni-graph__flyout-btn"
            role="menuitemcheckbox"
            :aria-pressed="dataLayers.collapseUserports"
            @click="toggleDataLayer('collapseUserports')"
          >
            User ports
          </button>
          <button
            type="button"
            class="tni-graph__flyout-btn"
            role="menuitemcheckbox"
            :aria-pressed="dataLayers.collapseNicPorts"
            @click="toggleDataLayer('collapseNicPorts')"
          >
            NIC ports
          </button>
        </div>
      </div>
    </div>
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
      <g ref="viewportRef" :transform="`translate(${tx} ${ty}) scale(${zoomLevel})`">
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
            :data-sim-id="n.id"
            :transform="nodeTransform(n)"
            :class="{
              selected: selected(n.id),
              dimmed: dimmed(n.id),
              hover: hoverKey === n.id,
              neighbor: hoverNeighbors.has(n.id),
              'child-link-target': childLinkTargetKeys.has(n.id),
            }"
            @pointerdown="onNodePointerDown(n.id, $event)"
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
        <g
          v-if="childLinkLines.length > 0"
          class="tni-graph__child-links"
          pointer-events="none"
        >
          <line
            v-for="(ln, i) in childLinkLines"
            :key="i"
            class="tni-graph__child-link-line"
            :x1="ln.x1"
            :y1="ln.y1"
            :x2="ln.x2"
            :y2="ln.y2"
          />
        </g>
      </g>
    </svg>
    <div
      ref="tooltipStackRef"
      data-tni-tooltip-stack
      class="tni-tooltip-stack"
      :class="{
        visible: tooltipVisible,
        'tni-tooltip-stack--interactive': tooltipStackInteractive,
      }"
      :style="{ left: `${tooltipPos.x}px`, top: `${tooltipPos.y}px` }"
      @pointerleave="onTooltipStackPointerLeave"
    >
      <div
        v-if="hoverNode"
        ref="tooltipPanelRef"
        class="tni-graph__tooltip tni-graph__tooltip--panel"
      >
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
        <div
          v-if="nodePropEntries(hoverNode).length > 0"
          class="tni-tip__props"
        >
          <div
            v-for="[k, v] in nodePropEntries(hoverNode)"
            :key="k"
            class="tni-tip__prop-row"
          >
            <span class="tni-tip__prop-k">{{ k }}</span>
            <span class="tni-tip__prop-v">{{ v }}</span>
          </div>
        </div>
        <div
          v-if="hoverCollapsedChildren.length > 0"
          class="tni-tip__collapsed"
          :class="{ 'tni-tip__collapsed--pinned': tooltipPinned }"
        >
          <div class="tni-tip__collapsed-title">
            Grouped here (data layers)
          </div>
          <div
            v-for="c in hoverCollapsedChildren"
            :key="`${c.type}:${c.id}`"
            class="tni-tip__collapsed-row"
            :class="{
              'tni-tip__collapsed-row--active':
                highlightCollapsedChildKey === nodeKey(c.type, c.id),
            }"
            @mouseenter="onCollapsedRowEnter(c, $event)"
            @mouseleave="onCollapsedRowLeave"
          >
            <span class="tni-tip__collapsed-icon-cell">
              <span
                v-if="collapsedTargetsFor(c).length > 0"
                class="tni-tip__link-icon"
                aria-label="Linked in graph"
                title="Linked in graph"
              >
                <svg class="tni-tip__link-svg" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                  <path
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.35"
                    stroke-linecap="round"
                    d="M6 9a3 3 0 0 1 0-4l1-1a3 3 0 0 1 4 4l-1 1M10 7a3 3 0 0 1 0 4l-1 1a3 3 0 0 1-4-4l1-1"
                  />
                </svg>
              </span>
            </span>
            <div class="tni-tip__collapsed-main">
              <span class="tni-tip__type">{{ c.type }}</span>
              <span class="tni-tip__sep">·</span>
              <span class="tni-tip__id">{{ c.id }}</span>
              <span
                v-if="c.properties['name']"
                class="tni-tip__collapsed-name"
              >{{ c.properties['name'] }}</span>
            </div>
          </div>
          <div v-if="!tooltipPinned" class="tni-tip__collapsed-hint">
            Hold <kbd>Shift</kbd> to pin, then hover a row for link targets.
          </div>
        </div>
        <div class="tni-tip__footer">
          neighbors: {{ hoverNeighbors.size }}
        </div>
      </div>
      <div
        v-else-if="hoverEdge"
        ref="tooltipPanelRef"
        class="tni-graph__tooltip tni-graph__tooltip--panel"
      >
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
      </div>
      <div
        v-if="highlightCollapsedChildModel"
        class="tni-graph__tooltip tni-graph__tooltip--child"
        :style="{
          left: `${childTipOffset.left}px`,
          top: `${childTipOffset.top}px`,
        }"
        @pointerleave="onChildTooltipPointerLeave"
      >
        <template
          v-for="(sec, secIdx) in childTooltipSections"
          :key="`${secIdx}-${sec.node.type}:${sec.node.id}`"
        >
          <div v-if="sec.before" class="tni-tip__bridge" role="presentation">
            <span class="tni-tip__bridge-line" />
            <span class="tni-tip__bridge-bubble">{{ sec.before }}</span>
            <span class="tni-tip__bridge-line" />
          </div>
          <div class="tni-tip__node-block">
            <div class="tni-tip__head">
              <span class="tni-tip__type">{{ sec.node.type }}</span>
              <span class="tni-tip__sep">·</span>
              <span class="tni-tip__id">{{ sec.node.id }}</span>
            </div>
            <div
              v-if="sec.node.properties['name']"
              class="tni-tip__name"
            >
              {{ sec.node.properties['name'] }}
            </div>
            <div
              v-if="sec.node.tags.length > 0"
              class="tni-tip__tags"
            >
              <span
                v-for="t in sec.node.tags"
                :key="t"
                class="tni-tip__tag"
              >{{ t }}</span>
            </div>
            <div
              v-if="nodePropEntries(sec.node).length > 0"
              class="tni-tip__props"
            >
              <div
                v-for="[k, v] in nodePropEntries(sec.node)"
                :key="k"
                class="tni-tip__prop-row"
              >
                <span class="tni-tip__prop-k">{{ k }}</span>
                <span class="tni-tip__prop-v">{{ v }}</span>
              </div>
            </div>
          </div>
        </template>
      </div>
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

.tni-graph__toolbar {
  position: absolute;
  top: 0.5rem;
  left: 0.5rem;
  z-index: 6;
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 0.35rem;
  pointer-events: auto;
}

.tni-graph__tool-row {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 0.35rem;
}

.tni-graph__tool-btn,
.tni-graph__flyout-btn {
  font-family: var(--tni-font-ui);
  font-size: 0.72rem;
  padding: 0.35rem 0.55rem;
  border-radius: var(--tni-radius);
  border: 1px solid var(--tni-border);
  background: var(--tni-bg-elevated);
  color: var(--tni-fg);
  cursor: pointer;
  text-align: left;
  box-shadow: var(--tni-shadow-1);
}

.tni-graph__tool-btn:hover,
.tni-graph__flyout-btn:hover {
  border-color: var(--tni-accent);
}

.tni-graph__tool-btn--on,
.tni-graph__flyout-btn[aria-pressed='true'] {
  background: var(--tni-accent);
  color: var(--tni-bg);
  border-color: var(--tni-accent);
}

.tni-graph__flyout {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 10.5rem;
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
  touch-action: none;
}

.tni-graph__nodes g.hover .tni-graph__node-shape {
  stroke: var(--tni-accent);
  stroke-width: 2;
}

.tni-graph__nodes g.child-link-target .tni-graph__node-shape {
  stroke: var(--tni-accent);
  stroke-width: 2;
  filter: drop-shadow(0 0 4px var(--tni-accent, #4a9eff));
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

.tni-tooltip-stack {
  position: absolute;
  z-index: 5;
  pointer-events: none;
  opacity: 0;
  transform: translateY(2px);
  transition: opacity 80ms ease, transform 80ms ease;
}

.tni-tooltip-stack.visible {
  opacity: 1;
  transform: translateY(0);
}

.tni-tooltip-stack--interactive {
  pointer-events: auto;
}

.tni-graph__tooltip {
  background: var(--tni-bg-elevated);
  color: var(--tni-fg);
  border: 1px solid var(--tni-border);
  border-radius: var(--tni-radius);
  padding: 0.5rem 0.75rem;
  font-size: 0.8rem;
  max-width: 20rem;
  box-shadow: var(--tni-shadow-2);
}

.tni-graph__tooltip--panel {
  position: relative;
  flex: 0 0 auto;
}

.tni-graph__tooltip--child {
  position: absolute;
  z-index: 2;
  min-width: 10rem;
  max-width: 18rem;
}

.tni-graph__child-links {
  pointer-events: none;
}

.tni-graph__child-link-line {
  stroke: var(--tni-accent, #4a9eff);
  stroke-width: 1.75;
  stroke-opacity: 0.9;
  stroke-dasharray: 5 3;
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

.tni-tip__props {
  margin-top: 0.35rem;
  font-family: var(--tni-font-mono);
  font-size: 0.72rem;
  line-height: 1.35;
  max-height: 10rem;
  overflow-y: auto;
}

.tni-tip__prop-row {
  display: flex;
  gap: 0.35rem;
  align-items: baseline;
}

.tni-tip__prop-k {
  color: var(--tni-fg-muted);
  flex: 0 0 auto;
}

.tni-tip__prop-v {
  color: var(--tni-fg);
  word-break: break-all;
}

.tni-tip__collapsed {
  margin-top: 0.35rem;
  padding-top: 0.35rem;
  border-top: 1px solid var(--tni-border);
  font-family: var(--tni-font-mono);
  font-size: 0.72rem;
  line-height: 1.4;
}

.tni-tip__collapsed-title {
  color: var(--tni-fg-muted);
  font-size: 0.68rem;
  margin-bottom: 0.2rem;
}

.tni-tip__collapsed-row {
  display: grid;
  grid-template-columns: 1.35rem minmax(0, 1fr);
  column-gap: 0.35rem;
  align-items: center;
  padding: 0.2rem 0.3rem;
  margin: 0.1rem -0.3rem;
  border-radius: calc(var(--tni-radius) - 2px);
}

.tni-tip__collapsed-row--active {
  background: var(--tni-bg);
  outline: 1px solid var(--tni-accent);
}

.tni-tip__collapsed-icon-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.35rem;
  justify-self: center;
}

.tni-tip__collapsed-main {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.15rem 0.35rem;
  min-width: 0;
}

.tni-tip__link-icon {
  display: inline-flex;
  align-items: center;
  color: var(--tni-accent);
  flex-shrink: 0;
}

.tni-tip__link-svg {
  display: block;
}

.tni-tip__bridge {
  display: flex;
  flex-direction: row;
  align-items: center;
  width: 100%;
  gap: 0.45rem;
  margin: 0.55rem 0 0.35rem;
}

.tni-tip__bridge-line {
  flex: 1 1 0;
  min-width: 0.35rem;
  height: 1px;
  background: var(--tni-border);
}

.tni-tip__bridge-bubble {
  flex-shrink: 0;
  font-family: var(--tni-font-ui);
  font-size: 0.58rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  line-height: 1;
  padding: 0.2rem 0.45rem;
  border-radius: 999px;
  border: 1px solid var(--tni-border);
  background: var(--tni-bg);
  color: var(--tni-accent);
}

.tni-tip__node-block {
  min-width: 0;
}

.tni-tip__collapsed-hint {
  margin-top: 0.35rem;
  font-size: 0.65rem;
  color: var(--tni-fg-muted);
  line-height: 1.35;
}

.tni-tip__collapsed-hint kbd {
  font-family: var(--tni-font-mono);
  font-size: 0.6rem;
  padding: 0.05rem 0.3rem;
  border: 1px solid var(--tni-border);
  border-radius: 3px;
  background: var(--tni-bg);
}

.tni-tip__collapsed-name {
  color: var(--tni-fg-muted);
  font-size: 0.68rem;
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
