/**
 * d3-force simulation wrapper per docs/specs/visualization.md §Forces.
 *
 * Responsibilities:
 *   - Translate `Graph` nodes/edges into d3 simulation objects (carrying
 *     an `x, y, vx, vy` plus `fx, fy` for pinning).
 *   - Configure forces (link, charge, center, collide, floorY).
 *   - Support swapping between `force` and `floor` layouts by toggling
 *     the `forceY` strength.
 *   - Pause/resume on `visibilitychange` so background tabs don't heat
 *     up the CPU.
 *
 * The simulation is advanced via `tick` events; the consumer (GraphView)
 * subscribes and re-renders SVG attributes on each tick.
 */

import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceY,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force';
import type { Edge, Graph, Node, NodeKey } from '@/model';
import { nodeKey } from '@/model';
import { nodeRadius } from './visuals';

export interface SimNode extends SimulationNodeDatum {
  /** `${type}:${id}` compound key (matches `Graph` indices). */
  id: NodeKey;
  model: Node;
  /** Floor number (walked via `graph.floorOf`). */
  floor?: number;
}

export interface SimLink extends SimulationLinkDatum<SimNode> {
  /** Derived edge id from `Edge`. */
  id: string;
  model: Edge;
  /** Override to preserve endpoint types at any stage of the simulation. */
  source: NodeKey | SimNode;
  target: NodeKey | SimNode;
}

export type LayoutMode = 'force' | 'floor';

export const FLOOR_SPACING = 120;

export interface LayoutOptions {
  /** Initial layout mode. */
  mode?: LayoutMode;
  /** Override default alpha decay (spec = 0.05). */
  alphaDecay?: number;
}

export class GraphLayout {
  readonly sim: Simulation<SimNode, SimLink>;
  private nodesArr: SimNode[] = [];
  private linksArr: SimLink[] = [];
  private mode: LayoutMode;

  constructor(opts: LayoutOptions = {}) {
    this.mode = opts.mode ?? 'force';
    this.sim = forceSimulation<SimNode, SimLink>()
      .alphaDecay(opts.alphaDecay ?? 0.05)
      .force(
        'link',
        forceLink<SimNode, SimLink>()
          .id((d) => d.id)
          .distance((e) => {
            const s = e.model.strength;
            const base = 40 + 20 * s;
            // Device ↔ layout port: keep the NIC arm visibly longer; ~2× base.
            if (e.model.relation === 'NIC') return base * 2;
            return base;
          })
          .strength((e) => 1 / Math.max(e.model.strength, 0.5)),
      )
      // Weaker repulsion so the graph does not over-spread; pairs with longer NIC.
      .force('charge', forceManyBody<SimNode>().strength(-95))
      .force('center', forceCenter(0, 0))
      .force(
        'collide',
        forceCollide<SimNode>().radius((d) => nodeRadius(d.model.type) + 2),
      )
      .force(
        'floorY',
        forceY<SimNode>()
          .y((d) => (d.floor != null ? d.floor * FLOOR_SPACING : 0))
          .strength((d) => this.floorStrength(d)),
      );
    this.sim.stop();
  }

  setGraph(graph: Graph): void {
    this.rebuildArrays(graph);
    this.sim.nodes(this.nodesArr);
    const linkForce = this.sim.force<ReturnType<typeof forceLink<SimNode, SimLink>>>('link');
    linkForce?.links(this.linksArr);
    this.sim.alpha(1).restart();
  }

  nodes(): ReadonlyArray<SimNode> {
    return this.nodesArr;
  }

  links(): ReadonlyArray<SimLink> {
    return this.linksArr;
  }

  setMode(mode: LayoutMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.sim.alpha(0.7).restart();
  }

  getMode(): LayoutMode {
    return this.mode;
  }

  /** Called by callers on `visibilitychange`. Stops the tick loop. */
  pause(): void {
    this.sim.stop();
  }

  /** Reheat and resume. */
  resume(alpha = 0.3): void {
    this.sim.alpha(alpha).restart();
  }

  /** Fully tear down. */
  destroy(): void {
    this.sim.stop();
    this.sim.on('tick', null);
  }

  private floorStrength(d: SimNode): number {
    if (this.mode !== 'floor') return 0;
    return d.floor != null ? 0.25 : 0;
  }

  private rebuildArrays(graph: Graph): void {
    const prevNodes = new Map(this.nodesArr.map((n) => [n.id, n]));
    this.nodesArr = [];
    for (const node of graph.nodes.values()) {
      const key = nodeKey(node.type, node.id);
      const prev = prevNodes.get(key);
      const floor = graph.floorOf(node.type, node.id);
      this.nodesArr.push({
        id: key,
        model: node,
        floor,
        x: prev?.x,
        y: prev?.y,
        vx: prev?.vx,
        vy: prev?.vy,
        fx: prev?.fx,
        fy: prev?.fy,
      });
    }
    this.linksArr = [];
    for (const edge of graph.edges.values()) {
      this.linksArr.push({
        id: edge.id,
        model: edge,
        source: edge.fromKey,
        target: edge.toKey,
      });
    }
  }
}
