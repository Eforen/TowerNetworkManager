import { describe, expect, it } from 'vitest';
import { Graph, syncEphemeralDevicePorts } from '@/model';
import {
  buildPresentationGraph,
  collapsedChildPresentationTargets,
  collapsedChildrenForParent,
  DEFAULT_DATA_LAYERS,
  parseDataLayersJson,
} from '@/view/presentationGraph';

function smallGraph(): Graph {
  const g = new Graph();
  g.addNode({ type: 'floor', id: 'f1' });
  g.addNode({ type: 'customer', id: 'c1' });
  g.addNode({ type: 'userport', id: '9', tags: ['RJ45'] });
  g.addNode({ type: 'networkaddress', id: '@a/1' });
  g.addNode({ type: 'server', id: 's1', properties: { portLayout: 'RJ45[1]' } });
  g.addEdge({
    relation: 'Owner',
    from: { type: 'customer', id: 'c1' },
    to: { type: 'userport', id: '9' },
  });
  g.addEdge({
    relation: 'AssignedTo',
    from: { type: 'networkaddress', id: '@a/1' },
    to: { type: 'customer', id: 'c1' },
  });
  g.addEdge({
    relation: 'FloorAssignment',
    from: { type: 'floor', id: 'f1' },
    to: { type: 'customer', id: 'c1' },
  });
  syncEphemeralDevicePorts(g);
  g.addEdge({
    relation: 'NetworkCableLinkRJ45',
    from: { type: 'port', id: 's1/port0' },
    to: { type: 'userport', id: '9' },
  });
  return g;
}

describe('presentationGraph', () => {
  it('returns a full clone when no layers active', () => {
    const g = smallGraph();
    const v = buildPresentationGraph(g, { ...DEFAULT_DATA_LAYERS });
    expect(v.nodes.size).toBe(g.nodes.size);
    expect(v.edges.size).toBe(g.edges.size);
  });

  it('hides floors and incident edges when showFloors is false', () => {
    const v = buildPresentationGraph(smallGraph(), {
      ...DEFAULT_DATA_LAYERS,
      showFloors: false,
    });
    expect(v.getNode('floor', 'f1')).toBeUndefined();
    const fa = [...v.edges.values()].filter((e) => e.relation === 'FloorAssignment');
    expect(fa.length).toBe(0);
    expect(v.getNode('customer', 'c1')).toBeDefined();
  });

  it('collapses userport into owner and rewires cable', () => {
    const v = buildPresentationGraph(smallGraph(), {
      ...DEFAULT_DATA_LAYERS,
      collapseUserports: true,
    });
    expect(v.getNode('userport', '9')).toBeUndefined();
    const cable = [...v.edges.values()].find(
      (e) => e.relation === 'NetworkCableLinkRJ45',
    );
    expect(cable).toBeDefined();
    expect(cable!.fromKey).toContain('port');
    expect(cable!.toKey).toBe('customer:c1');
  });

  it('collapses networkaddress into assignee', () => {
    const v = buildPresentationGraph(smallGraph(), {
      ...DEFAULT_DATA_LAYERS,
      collapseNetworkAddresses: true,
    });
    expect(v.getNode('networkaddress', '@a/1')).toBeUndefined();
    const at = [...v.edges.values()].filter((e) => e.relation === 'AssignedTo');
    expect(at.length).toBe(0);
  });

  it('collapses NIC port into device', () => {
    const v = buildPresentationGraph(smallGraph(), {
      ...DEFAULT_DATA_LAYERS,
      collapseNicPorts: true,
    });
    expect(v.getNode('port', 's1/port0')).toBeUndefined();
    const nic = [...v.edges.values()].filter((e) => e.relation === 'NIC');
    expect(nic.length).toBe(0);
  });

  it('parseDataLayersJson tolerates null', () => {
    expect(parseDataLayersJson(null)).toEqual(DEFAULT_DATA_LAYERS);
  });

  it('collapsedChildrenForParent is empty when no collapse', () => {
    const g = smallGraph();
    const kids = collapsedChildrenForParent(g, { ...DEFAULT_DATA_LAYERS }, 'customer:c1');
    expect(kids).toEqual([]);
  });

  it('collapsedChildrenForParent lists userports under owner', () => {
    const g = smallGraph();
    const kids = collapsedChildrenForParent(
      g,
      { ...DEFAULT_DATA_LAYERS, collapseUserports: true },
      'customer:c1',
    );
    expect(kids.map((n) => `${n.type}:${n.id}`)).toEqual(['userport:9']);
  });

  it('collapsedChildrenForParent lists networkaddress under assignee', () => {
    const g = smallGraph();
    const kids = collapsedChildrenForParent(
      g,
      { ...DEFAULT_DATA_LAYERS, collapseNetworkAddresses: true },
      'customer:c1',
    );
    expect(kids.map((n) => `${n.type}:${n.id}`)).toEqual(['networkaddress:@a/1']);
  });

  it('collapsedChildrenForParent lists NIC ports under device', () => {
    const g = smallGraph();
    const kids = collapsedChildrenForParent(
      g,
      { ...DEFAULT_DATA_LAYERS, collapseNicPorts: true },
      'server:s1',
    );
    expect(kids.some((n) => n.type === 'port' && n.id === 's1/port0')).toBe(true);
  });

  it('collapsedChildPresentationTargets maps cables through collapse', () => {
    const g = smallGraph();
    const layers = {
      ...DEFAULT_DATA_LAYERS,
      collapseUserports: true,
      collapseNicPorts: true,
    };
    const t = collapsedChildPresentationTargets(g, layers, 'userport:9');
    expect(t).toContain('server:s1');
    expect(t).not.toContain('customer:c1');
  });

  it('collapsedChildPresentationTargets empty for address with only assignee', () => {
    const g = smallGraph();
    const layers = { ...DEFAULT_DATA_LAYERS, collapseNetworkAddresses: true };
    const t = collapsedChildPresentationTargets(g, layers, 'networkaddress:@a/1');
    expect(t).toEqual([]);
  });
});
